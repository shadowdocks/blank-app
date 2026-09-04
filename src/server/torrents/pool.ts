import { logLine } from "../../access-log";
import type { MediaTarget } from "../../shared/playback";
import { RqbitClient, defaultRqbitClient } from "./client";
import type { TorrentPoolConfig, TorrentPoolEntry } from "./types";

export function hashFromMagnet(magnet: string): string | null {
  return /xt=urn:btih:([0-9a-f]{40}|[2-7a-z]{32})/i.exec(magnet)?.[1].toLowerCase() ?? null;
}

export class TorrentPool {
  private entries = new Map<string, TorrentPoolEntry>();
  private creating = new Map<string, Promise<TorrentPoolEntry>>();
  private client: RqbitClient;
  public readonly config: TorrentPoolConfig;

  constructor(client: RqbitClient = defaultRqbitClient, config?: Partial<TorrentPoolConfig>) {
    this.client = client;

    const envMax = process.env.HAWK_TORRENT_POOL_MAX ? Number.parseInt(process.env.HAWK_TORRENT_POOL_MAX, 10) : undefined;
    const envTtlMin = process.env.HAWK_TORRENT_POOL_TTL_MINUTES ? Number.parseInt(process.env.HAWK_TORRENT_POOL_TTL_MINUTES, 10) : undefined;
    const envTtlMs = process.env.HAWK_TORRENT_POOL_TTL_MS ? Number.parseInt(process.env.HAWK_TORRENT_POOL_TTL_MS, 10) : undefined;

    this.config = {
      maxTorrents: config?.maxTorrents ?? envMax ?? 4,
      idleTtlMs: config?.idleTtlMs ?? envTtlMs ?? (envTtlMin ? envTtlMin * 60 * 1000 : 30 * 60 * 1000), // default 30 min
      recentStreamGraceMs: config?.recentStreamGraceMs ?? 10 * 60 * 1000, // 10 min protection for recently streamed
    };
  }

  get size(): number {
    return this.entries.size;
  }

  get(hash: string): TorrentPoolEntry | undefined {
    const entry = this.entries.get(hash.toLowerCase());
    if (entry) {
      entry.lastAccessedAt = Date.now();
    }
    return entry;
  }

  has(hash: string): boolean {
    return this.entries.has(hash.toLowerCase());
  }

  touchStream(hash: string, delta: number): void {
    const entry = this.entries.get(hash.toLowerCase());
    if (!entry) return;
    entry.activeStreams = Math.max(0, entry.activeStreams + delta);
    entry.lastAccessedAt = Date.now();
    if (delta > 0) {
      entry.lastStreamedAt = Date.now();
    }
  }

  async cleanIdle(): Promise<number> {
    const now = Date.now();
    const idleHashes: string[] = [];

    for (const [hash, entry] of this.entries.entries()) {
      if (entry.activeStreams === 0 && now - entry.lastAccessedAt > this.config.idleTtlMs) {
        idleHashes.push(hash);
      }
    }

    if (idleHashes.length === 0) return 0;

    for (const hash of idleHashes) {
      this.entries.delete(hash);
      try {
        await this.client.deleteTorrent(hash);
      } catch (err) {
        logLine("rqbit", `event=idle_cleanup_error hash=${hash} error=${JSON.stringify(String(err))}`, "warn");
      }
    }

    logLine("rqbit", `event=torrent_idle_cleanup evicted=${idleHashes.length} remaining=${this.entries.size}`);
    return idleHashes.length;
  }

  private async evictOneIfNecessary(): Promise<boolean> {
    if (this.entries.size + this.creating.size <= this.config.maxTorrents) {
      return false;
    }

    // Step 1: Try cleaning idle entries first
    await this.cleanIdle();
    if (this.entries.size + this.creating.size <= this.config.maxTorrents) {
      return true;
    }

    // Step 2: Find evictable candidates (not active, not recently streamed)
    const now = Date.now();
    let oldestCandidate: TorrentPoolEntry | null = null;

    for (const entry of this.entries.values()) {
      if (entry.activeStreams > 0) {
        continue; // Never evict active streams
      }

      const isRecentlyStreamed =
        entry.lastStreamedAt !== null && now - entry.lastStreamedAt < this.config.recentStreamGraceMs;

      if (isRecentlyStreamed) {
        continue; // Never evict recently streamed entries
      }

      if (!oldestCandidate || entry.lastAccessedAt < oldestCandidate.lastAccessedAt) {
        oldestCandidate = entry;
      }
    }

    if (!oldestCandidate) {
      logLine(
        "rqbit",
        `event=torrent_eviction_blocked size=${this.entries.size} max=${this.config.maxTorrents} reason=all_entries_active_or_recently_streamed`,
        "warn",
      );
      return false;
    }

    const hashToEvict = oldestCandidate.hash;
    this.entries.delete(hashToEvict);
    logLine("rqbit", `event=torrent_evicted hash=${hashToEvict} reason=capacity pool_size=${this.entries.size}`);

    try {
      await this.client.deleteTorrent(hashToEvict);
    } catch (err) {
      logLine("rqbit", `event=torrent_evict_error hash=${hashToEvict} error=${JSON.stringify(String(err))}`, "warn");
    }

    return true;
  }

  async getOrCreate(
    magnet: string,
    target?: MediaTarget,
    signal?: AbortSignal,
    preferredFileIndex: number | null = null,
  ): Promise<TorrentPoolEntry> {
    const hash = hashFromMagnet(magnet);
    if (!hash) {
      throw Object.assign(new Error("A valid magnet link is required."), { status: 400 });
    }

    const pending = this.creating.get(hash);
    if (pending) return pending;

    // Reuse duplicate hashes
    const existing = this.entries.get(hash);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      if (target) {
        existing.target = target;
      }
      if (preferredFileIndex !== null) existing.preferredFileIndex = preferredFileIndex;
      logLine("rqbit", `event=torrent_reused hash=${hash}`);
      return existing;
    }

    const needsCapacity = this.entries.size + this.creating.size >= this.config.maxTorrents;
    const creation = Promise.resolve().then(async () => {
      const evicted = needsCapacity ? await this.evictOneIfNecessary() : false;
      if (needsCapacity && !evicted) {
        throw Object.assign(new Error("All torrent slots are currently in use."), { status: 503 });
      }

      const startedAt = Date.now();
      let details;
      try {
        details = await this.client.getDetails(hash, signal);
        logLine("rqbit", `event=torrent_adopted hash=${hash}`);
      } catch (error) {
        const status = typeof error === "object" && error && "status" in error
          ? Number((error as { status?: unknown }).status)
          : 0;
        if (status !== 404) throw error;
        logLine("rqbit", `event=torrent_start hash=${hash}`);
        details = await this.client.addTorrent(magnet, signal);
      }
      const entry: TorrentPoolEntry = {
        hash,
        name: details.name || "Resolving metadata…",
        startedAt,
        lastAccessedAt: Date.now(),
        lastStreamedAt: null,
        activeStreams: 0,
        preferredFileIndex,
        target,
        details,
      };

      this.entries.set(hash, entry);
      logLine(
        "rqbit",
        `event=torrent_metadata hash=${hash} files=${details.files?.length ?? 0} pool_size=${this.entries.size}`,
      );
      return entry;
    });

    this.creating.set(hash, creation);
    try {
      return await creation;
    } finally {
      this.creating.delete(hash);
    }
  }

  async delete(hash: string, signal?: AbortSignal): Promise<boolean> {
    const normalized = hash.toLowerCase();
    this.entries.delete(normalized);
    return this.client.deleteTorrent(normalized, signal);
  }

  getAllEntries(): TorrentPoolEntry[] {
    return Array.from(this.entries.values());
  }
}

export const defaultTorrentPool = new TorrentPool(defaultRqbitClient);
