import { describe, expect, it } from "bun:test";
import { TorrentPool } from "./pool";
import type { RqbitDetails, RqbitStats } from "./types";
import { RqbitClient } from "./client";

class MockRqbitClient extends RqbitClient {
  public added: string[] = [];
  public deleted: string[] = [];
  public existing = new Set<string>();

  constructor() {
    super("http://127.0.0.1:9999");
  }

  override async addTorrent(magnet: string): Promise<RqbitDetails> {
    this.added.push(magnet);
    const hash = /xt=urn:btih:([0-9a-f]{40})/i.exec(magnet)?.[1].toLowerCase() ?? "unknown";
    this.existing.add(hash);
    return {
      info_hash: hash,
      name: `Torrent ${hash}`,
      files: [{ name: `video-${hash}.mkv`, length: 1_000_000, included: true }],
    };
  }

  override async deleteTorrent(hash: string): Promise<boolean> {
    this.deleted.push(hash.toLowerCase());
    return true;
  }

  override async getDetails(hash: string): Promise<RqbitDetails> {
    if (!this.existing.has(hash)) {
      throw Object.assign(new Error("not found"), { status: 404 });
    }
    return {
      info_hash: hash,
      name: `Torrent ${hash}`,
      files: [{ name: `video-${hash}.mkv`, length: 1_000_000, included: true }],
    };
  }

  override async getStats(): Promise<RqbitStats> {
    return {
      state: "live",
      progress_bytes: 100_000,
      total_bytes: 1_000_000,
      finished: false,
    };
  }
}

describe("TorrentPool", () => {
  it("reuses duplicate hashes without redundant additions", async () => {
    const mock = new MockRqbitClient();
    const pool = new TorrentPool(mock, { maxTorrents: 4, idleTtlMs: 60_000 });

    const magnet = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=Test1";

    const first = await pool.getOrCreate(magnet);
    expect(mock.added.length).toBe(1);
    expect(pool.size).toBe(1);

    const second = await pool.getOrCreate(magnet);
    expect(mock.added.length).toBe(1); // Not added again
    expect(pool.size).toBe(1);
    expect(first.hash).toBe(second.hash);
  });

  it("adopts a torrent retained by rqbit after a backend restart", async () => {
    const mock = new MockRqbitClient();
    const hash = "1111111111111111111111111111111111111111";
    mock.existing.add(hash);
    const pool = new TorrentPool(mock, { maxTorrents: 4, idleTtlMs: 60_000 });

    const entry = await pool.getOrCreate(`magnet:?xt=urn:btih:${hash}`);

    expect(entry.hash).toBe(hash);
    expect(mock.added).toHaveLength(0);
    expect(pool.size).toBe(1);
  });

  it("preserves and updates a provider file preference when reusing a torrent", async () => {
    const mock = new MockRqbitClient();
    const pool = new TorrentPool(mock, { maxTorrents: 4, idleTtlMs: 60_000 });
    const magnet = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";

    const first = await pool.getOrCreate(magnet, undefined, undefined, 7);
    expect(first.preferredFileIndex).toBe(7);

    const reused = await pool.getOrCreate(magnet, undefined, undefined, 3);
    expect(reused.preferredFileIndex).toBe(3);
    expect(mock.added).toHaveLength(1);
  });

  it("evicts oldest idle entry when capacity is reached", async () => {
    const mock = new MockRqbitClient();
    // Capacity 3
    const pool = new TorrentPool(mock, { maxTorrents: 3, idleTtlMs: 60_000, recentStreamGraceMs: 5_000 });

    const m1 = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";
    const m2 = "magnet:?xt=urn:btih:2222222222222222222222222222222222222222";
    const m3 = "magnet:?xt=urn:btih:3333333333333333333333333333333333333333";
    const m4 = "magnet:?xt=urn:btih:4444444444444444444444444444444444444444";

    const now = Date.now();
    const e1 = await pool.getOrCreate(m1);
    e1.lastAccessedAt = now - 5000; // Oldest, but within 60s idle TTL

    const e2 = await pool.getOrCreate(m2);
    e2.lastAccessedAt = now - 3000;

    const e3 = await pool.getOrCreate(m3);
    e3.lastAccessedAt = now - 1000;

    expect(pool.size).toBe(3);

    // Adding 4th should evict e1 (oldest idle)
    await pool.getOrCreate(m4);

    expect(pool.size).toBe(3);
    expect(pool.has("1111111111111111111111111111111111111111")).toBe(false);
    expect(pool.has("4444444444444444444444444444444444444444")).toBe(true);
    expect(mock.deleted).toContain("1111111111111111111111111111111111111111");
  });

  it("never evicts actively streaming or recently streamed entries", async () => {
    const mock = new MockRqbitClient();
    const pool = new TorrentPool(mock, {
      maxTorrents: 2,
      idleTtlMs: 60_000,
      recentStreamGraceMs: 60_000, // 60s grace period
    });

    const m1 = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";
    const m2 = "magnet:?xt=urn:btih:2222222222222222222222222222222222222222";
    const m3 = "magnet:?xt=urn:btih:3333333333333333333333333333333333333333";

    const now = Date.now();
    const e1 = await pool.getOrCreate(m1);
    e1.lastAccessedAt = now - 5000; // Older access time
    // But e1 is actively streaming!
    pool.touchStream(e1.hash, 1);

    const e2 = await pool.getOrCreate(m2);
    e2.lastAccessedAt = now - 2000;
    // e2 is not streaming and was not recently streamed

    // Adding m3 must evict e2 because e1 is actively streaming
    await pool.getOrCreate(m3);

    expect(pool.has(e1.hash)).toBe(true);
    expect(pool.has(e2.hash)).toBe(false);
    expect(mock.deleted).toContain(e2.hash);
  });

  it("cleans idle entries past TTL", async () => {
    const mock = new MockRqbitClient();
    const pool = new TorrentPool(mock, { maxTorrents: 4, idleTtlMs: 1000 });

    const m1 = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";
    const e1 = await pool.getOrCreate(m1);
    e1.lastAccessedAt = Date.now() - 2000; // Past 1s TTL

    const cleanedCount = await pool.cleanIdle();
    expect(cleanedCount).toBe(1);
    expect(pool.size).toBe(0);
    expect(mock.deleted).toContain(e1.hash);
  });

  it("supports explicit deletion", async () => {
    const mock = new MockRqbitClient();
    const pool = new TorrentPool(mock, { maxTorrents: 4 });

    const m1 = "magnet:?xt=urn:btih:1111111111111111111111111111111111111111";
    await pool.getOrCreate(m1);
    expect(pool.has("1111111111111111111111111111111111111111")).toBe(true);

    const deleted = await pool.delete("1111111111111111111111111111111111111111");
    expect(deleted).toBe(true);
    expect(pool.has("1111111111111111111111111111111111111111")).toBe(false);
  });
});
