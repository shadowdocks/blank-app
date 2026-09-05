import { logLine } from "../../access-log";
import type { AudioCodec, ClientCapabilities, MediaTarget, PlaybackSource } from "./types";
import { fetchTorrentio } from "./torrentio";
import { fetchApiBay } from "./apibay";
import { rankSources } from "./ranking";
import { probeSourceProviders } from "./health";

export * from "./types";
export * from "./ranking";
export * from "./torrentio";
export * from "./apibay";
export * from "./health";

export interface FindSourcesOptions {
  torrentioTimeoutMs?: number;
  apibayTimeoutMs?: number;
  signal?: AbortSignal;
  capabilities?: ClientCapabilities;
}

export async function findSources(
  target: MediaTarget,
  options: FindSourcesOptions = {},
): Promise<PlaybackSource[]> {
  const {
    torrentioTimeoutMs = 4000,
    apibayTimeoutMs = 3500,
    signal,
    capabilities,
  } = options;

  // Run Torrentio (primary) and APiBay (fallback) concurrently with individual timeouts
  const [torrentioResult, apibayResult] = await Promise.allSettled([
    target.imdbId ? fetchTorrentio(target, torrentioTimeoutMs, signal) : Promise.resolve([]),
    fetchApiBay(target, apibayTimeoutMs, signal),
  ]);

  const torrentioSources = torrentioResult.status === "fulfilled" ? torrentioResult.value : [];
  const apibaySources = apibayResult.status === "fulfilled" ? apibayResult.value : [];

  if (torrentioResult.status === "rejected") {
    logLine("api", `event=sources_torrentio_error title=${JSON.stringify(target.title)} error=${JSON.stringify(String(torrentioResult.reason))}`, "warn");
  }
  if (apibayResult.status === "rejected") {
    logLine("api", `event=sources_apibay_error title=${JSON.stringify(target.title)} error=${JSON.stringify(String(apibayResult.reason))}`, "warn");
  }

  // Deduplicate by normalized infoHash. Prefer Torrentio when both have the same hash
  const sourceMap = new Map<string, PlaybackSource>();

  // Primary: Torrentio
  for (const src of torrentioSources) {
    const key = src.infoHash.toUpperCase();
    sourceMap.set(key, src);
  }

  // Fallback: APiBay
  for (const src of apibaySources) {
    const key = src.infoHash.toUpperCase();
    if (!sourceMap.has(key)) {
      sourceMap.set(key, src);
    } else {
      const existing = sourceMap.get(key)!;
      // If Torrentio gave 0 seeders but APiBay reported active seeders, enrich
      if (existing.seeders === 0 && src.seeders > 0) {
        existing.seeders = src.seeders;
      }
      if (existing.sizeBytes === null && src.sizeBytes !== null) {
        existing.sizeBytes = src.sizeBytes;
      }
    }
  }

  const merged = Array.from(sourceMap.values());
  const ranked = rankSources(merged, target, capabilities);

  logLine(
    "api",
    `event=sources_found title=${JSON.stringify(target.title)} torrentio=${torrentioSources.length} apibay=${apibaySources.length} unique=${ranked.length}`,
  );

  return ranked;
}

function parseCodecsList(param: string | null): AudioCodec[] | undefined {
  if (!param) return undefined;
  const valid: AudioCodec[] = ["aac", "ac3", "eac3", "opus", "mp3", "unknown"];
  const list = param
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is AudioCodec => valid.includes(c as AudioCodec));
  return list.length > 0 ? list : undefined;
}

export async function handleSourcesRequest(requestOrUrl: Request | URL): Promise<Response> {
  const url = requestOrUrl instanceof URL ? requestOrUrl : new URL(requestOrUrl.url);
  const signal = requestOrUrl instanceof Request ? requestOrUrl.signal : undefined;

  const title = url.searchParams.get("title")?.trim();
  if (!title) {
    return Response.json({ error: "A title is required." }, { status: 400 });
  }

  const rawType = url.searchParams.get("type") ?? url.searchParams.get("mediaType");
  const mediaType = rawType === "tv" ? "tv" : "movie";
  const imdbId = url.searchParams.get("imdbId") ?? url.searchParams.get("id") ?? "";
  const yearStr = url.searchParams.get("year");
  const seasonStr = url.searchParams.get("season");
  const episodeStr = url.searchParams.get("episode");

  const target: MediaTarget = {
    title,
    mediaType,
    imdbId,
    year: yearStr ? Number.parseInt(yearStr, 10) || null : null,
    season: seasonStr ? Number.parseInt(seasonStr, 10) || null : null,
    episode: episodeStr ? Number.parseInt(episodeStr, 10) || null : null,
    episodeTitle: url.searchParams.get("episodeTitle") ?? null,
  };

  const audioCodecsParam = url.searchParams.get("audioCodecs");
  const supportedAudioCodecsParam = url.searchParams.get("supportedAudioCodecs");
  const unsupportedAudioCodecsParam = url.searchParams.get("unsupportedAudioCodecs");

  const capabilities: ClientCapabilities | undefined =
    audioCodecsParam || supportedAudioCodecsParam || unsupportedAudioCodecsParam
      ? {
          audioCodecs: parseCodecsList(audioCodecsParam),
          supportedAudioCodecs: parseCodecsList(supportedAudioCodecsParam),
          unsupportedAudioCodecs: parseCodecsList(unsupportedAudioCodecsParam),
        }
      : undefined;

  try {
    const results = await findSources(target, { signal, capabilities });
    if (!results.length) {
      return Response.json({ error: "No streams found." }, { status: 404 });
    }
    return Response.json({ results });
  } catch (error) {
    logLine("api", `event=sources_error title=${JSON.stringify(title)} error=${JSON.stringify(String(error))}`, "error");
    return Response.json(
      { error: error instanceof Error ? error.message : "Source search failed." },
      { status: 502 },
    );
  }
}

export async function handleSourcesHealthRequest(): Promise<Response> {
  try {
    const providers = await probeSourceProviders();
    const allOk = providers.every((p) => p.status === "ok");
    return Response.json({ status: allOk ? "ok" : "degraded", providers }, { status: allOk ? 200 : 207 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
