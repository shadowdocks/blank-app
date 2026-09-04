import type { MediaTarget } from "../src/shared/playback";
import { rankSources } from "../src/server/sources/ranking";
import { fetchTorrentio } from "../src/server/sources/torrentio";

const SOURCE_CACHE_SECONDS = 120;

function optionalInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function targetFromUrl(url: URL): MediaTarget | null {
  const title = url.searchParams.get("title")?.trim();
  const imdbId = url.searchParams.get("imdbId")?.trim() ?? "";
  if (!title || !/^tt\d{7,10}$/.test(imdbId)) return null;

  return {
    title,
    imdbId,
    mediaType: url.searchParams.get("mediaType") === "tv" || url.searchParams.get("type") === "tv" ? "tv" : "movie",
    year: optionalInteger(url.searchParams.get("year")),
    season: optionalInteger(url.searchParams.get("season")),
    episode: optionalInteger(url.searchParams.get("episode")),
    episodeTitle: url.searchParams.get("episodeTitle")?.trim() || null,
  };
}

function cacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/~\/\+/, "") || "/";
  url.searchParams.sort();
  return new Request(url, { method: "GET" });
}

export async function handleEdgeSources(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  const target = targetFromUrl(url);
  if (!target) return null;

  const cache = typeof caches !== "undefined"
    ? (caches as CacheStorage & { default?: Cache }).default ?? null
    : null;
  const key = cacheKey(request);
  const cached = await cache?.match(key);
  if (cached) return cached;

  try {
    const sources = rankSources(await fetchTorrentio(target, 5_000, request.signal), target);
    if (!sources.length) return null;

    const response = Response.json(
      { results: sources },
      {
        headers: {
          "cache-control": `public, max-age=30, s-maxage=${SOURCE_CACHE_SECONDS}, stale-while-revalidate=60`,
          "x-hawk-source-egress": "edge",
        },
      },
    );
    if (cache) ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "sources.edge_fallback",
      imdbId: target.imdbId,
      error: String(error),
    }));
    return null;
  }
}
