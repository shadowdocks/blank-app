import { createMagnetUri, type MediaTarget, type PlaybackSource } from "./types";
import { parseCodec, parseContainer, parseHdr, parseQuality } from "./ranking";

export interface TorrentioStream {
  name?: string;
  title?: string;
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
  };
}

export interface TorrentioResponse {
  streams?: TorrentioStream[];
}

function parseSizeToBytes(sizeText: string): number | null {
  const match = /([\d.]+)\s*(GB|MB|KB|B)/i.exec(sizeText);
  if (!match) return null;
  const val = Number.parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (!Number.isFinite(val) || val <= 0) return null;

  switch (unit) {
    case "GB":
      return Math.round(val * 1024 * 1024 * 1024);
    case "MB":
      return Math.round(val * 1024 * 1024);
    case "KB":
      return Math.round(val * 1024);
    case "B":
      return Math.round(val);
    default:
      return null;
  }
}

export function parseTorrentioStream(stream: TorrentioStream): PlaybackSource | null {
  if (!stream || !stream.infoHash || !/^[a-f0-9]{40}$/i.test(stream.infoHash)) {
    return null;
  }

  const rawTitle = stream.title ?? "";
  const rawName = stream.name ?? "";
  const filename = stream.behaviorHints?.filename;
  const lines = rawTitle.split("\n").map((l) => l.trim()).filter(Boolean);

  let seeders = 0;
  let sizeBytes: number | null = null;
  const titleLines: string[] = [];

  for (const line of lines) {
    const seedMatch = /👤\s*(\d+)/.exec(line);
    const sizeMatch = /💾\s*([\d.]+\s*[A-Za-z]+)/.exec(line);

    if (seedMatch) {
      seeders = Number.parseInt(seedMatch[1], 10) || 0;
    }
    if (sizeMatch) {
      sizeBytes = parseSizeToBytes(sizeMatch[1]);
    }
    if (!seedMatch && !sizeMatch && !line.includes("⚙️")) {
      titleLines.push(line);
    }
  }

  const releaseName = filename || titleLines.join(" ") || rawTitle.split("\n")[0] || "Torrentio Stream";
  const combinedContext = `${rawName} ${rawTitle} ${filename ?? ""} ${stream.behaviorHints?.bingeGroup ?? ""}`;

  const quality = parseQuality(combinedContext);
  const container = parseContainer(releaseName);
  const codec = parseCodec(combinedContext);
  const hdr = parseHdr(combinedContext);
  const infoHash = stream.infoHash.toUpperCase();
  const fileIndex = typeof stream.fileIdx === "number" ? stream.fileIdx : null;

  return {
    id: `torrentio-${infoHash}${fileIndex !== null ? `-${fileIndex}` : ""}`,
    provider: "torrentio",
    name: releaseName,
    infoHash,
    magnet: createMagnetUri(infoHash, releaseName),
    fileIndex,
    seeders,
    leechers: 0,
    sizeBytes,
    quality,
    container,
    codec,
    hdr,
    score: 0,
  };
}

export async function fetchTorrentio(
  target: MediaTarget,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<PlaybackSource[]> {
  if (!target.imdbId) return [];

  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process;
  const baseUrl = (runtimeProcess?.env?.TORRENTIO_URL ?? "https://torrentio.strem.fun").replace(/\/+$/, "");
  let endpoint: string;

  if (target.mediaType === "tv") {
    const season = target.season ?? 1;
    const episode = target.episode ?? 1;
    endpoint = `${baseUrl}/stream/series/${encodeURIComponent(target.imdbId)}:${season}:${episode}.json`;
  } else {
    endpoint = `${baseUrl}/stream/movie/${encodeURIComponent(target.imdbId)}.json`;
  }

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
      throw new Error(`Torrentio returned HTTP ${response.status}`);
    }

    const data = (await response.json()) as TorrentioResponse;
    if (!data || !Array.isArray(data.streams)) {
      return [];
    }

    const results: PlaybackSource[] = [];
    for (const stream of data.streams) {
      const parsed = parseTorrentioStream(stream);
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
