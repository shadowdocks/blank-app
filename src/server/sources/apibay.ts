import { createMagnetUri, type MediaTarget, type PlaybackSource } from "./types";
import { parseCodec, parseContainer, parseHdr, parseQuality } from "./ranking";

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
  const cleanTitle = target.title.replace(/[^\w\s.-]/g, " ").replace(/\s+/g, " ").trim();
  if (target.mediaType === "tv") {
    const s = String(target.season ?? 1).padStart(2, "0");
    const e = String(target.episode ?? 1).padStart(2, "0");
    return `${cleanTitle} S${s}E${e}`;
  }
  if (target.year) {
    return `${cleanTitle} ${target.year}`;
  }
  return cleanTitle;
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
    score: 0,
  };
}

export async function fetchApiBay(
  target: MediaTarget,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<PlaybackSource[]> {
  const query = buildApiBayQuery(target);
  if (!query) return [];

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
