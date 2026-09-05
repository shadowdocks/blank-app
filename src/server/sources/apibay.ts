import { createMagnetUri, type MediaTarget, type PlaybackSource } from "./types";
import { parseAudioCodec, parseCodec, parseContainer, parseHdr, parseQuality } from "./ranking";

export interface ApiBayRow {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  size: string;
  category?: string;
  imdb?: string;
}

export function buildApiBayQuery(target: MediaTarget): string {
  const titleWithoutYear = target.title
    .replace(/\s*\(\s*\d{4}\s*\)\s*$/, "")
    .replace(/\s+\d{4}$/, "");
  const cleanTitle = titleWithoutYear.replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();

  if (target.mediaType === "tv") {
    const s = String(target.season ?? 1).padStart(2, "0");
    if (target.episode !== null && target.episode !== undefined) {
      const e = String(target.episode).padStart(2, "0");
      return `${cleanTitle} S${s}E${e}`;
    }
    return `${cleanTitle} S${s}`;
  }

  if (target.year) {
    return `${cleanTitle} ${target.year}`;
  }

  return cleanTitle;
}

export function buildApiBayQueries(target: MediaTarget): string[] {
  const queries: string[] = [];
  const primary = buildApiBayQuery(target);
  if (primary) {
    queries.push(primary);
  }

  if (
    target.mediaType === "tv" &&
    target.season !== null &&
    target.season !== undefined &&
    target.episode !== null &&
    target.episode !== undefined
  ) {
    const titleWithoutYear = target.title
      .replace(/\s*\(\s*\d{4}\s*\)\s*$/, "")
      .replace(/\s+\d{4}$/, "");
    const cleanTitle = titleWithoutYear.replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();
    const alt = `${cleanTitle} ${target.season}x${String(target.episode).padStart(2, "0")}`;
    if (alt && !queries.includes(alt)) {
      queries.push(alt);
    }
  }

  return queries;
}

export function parseApiBayRow(row: ApiBayRow): PlaybackSource | null {
  if (!row || row.id === "0" || !/^[a-f0-9]{40}$/i.test(row.info_hash)) {
    return null;
  }

  const name = row.name || "Unknown APiBay Release";
  const infoHash = row.info_hash.toUpperCase();
  const seeders = Number.parseInt(row.seeders, 10) || 0;
  const leechers = Number.parseInt(row.leechers, 10) || 0;
  const rawSize = Number.parseInt(row.size, 10);
  const sizeBytes = Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null;

  const quality = parseQuality(name);
  const container = parseContainer(name);
  const codec = parseCodec(name);
  const hdr = parseHdr(name);
  const audioCodec = parseAudioCodec(name);

  return {
    id: `apibay-${infoHash}`,
    provider: "apibay",
    name,
    infoHash,
    magnet: createMagnetUri(infoHash, name),
    fileIndex: null,
    seeders,
    leechers,
    sizeBytes,
    quality,
    container,
    codec,
    hdr,
    audioCodec,
    score: 0,
  };
}

async function queryApiBay(
  query: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PlaybackSource[]> {
  const baseUrl = (process.env.APIBAY_URL ?? "https://apibay.org").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/q.php?q=${encodeURIComponent(query)}&cat=200`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "hawk/2.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`APiBay returned HTTP ${response.status}`);
    }

    const rows = (await response.json()) as ApiBayRow[];
    if (!Array.isArray(rows)) {
      return [];
    }

    const results: PlaybackSource[] = [];
    for (const row of rows) {
      const parsed = parseApiBayRow(row);
      if (parsed) {
        results.push(parsed);
      }
    }
    return results;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function fetchApiBay(
  target: MediaTarget,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<PlaybackSource[]> {
  const queries = buildApiBayQueries(target);
  if (!queries.length) return [];

  const primaryResults = await queryApiBay(queries[0], timeoutMs, signal);
  if (primaryResults.length > 0 || queries.length === 1) {
    return primaryResults;
  }

  const fallbackResults = await queryApiBay(queries[1], Math.min(timeoutMs, 5000), signal);
  const seen = new Set<string>();
  const combined: PlaybackSource[] = [];
  for (const src of [...primaryResults, ...fallbackResults]) {
    if (!seen.has(src.infoHash)) {
      seen.add(src.infoHash);
      combined.push(src);
    }
  }
  return combined;
}
