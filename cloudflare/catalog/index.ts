import {
  type CatalogEnv,
  type ExecutionContext,
  ResponseError,
  UpstreamError,
} from "./env";
import {
  DISCOVER_QUERY,
  EPISODES_QUERY,
  HERO_ART_QUERY,
  TITLE_DETAIL_QUERY,
} from "./queries";
import {
  type SuggestionItem,
  type TitleNode,
  normalizeBackdrop,
  normalizeEpisodes,
  normalizeMediaSummary,
  normalizeSuggestionItem,
  normalizeTitleDetail,
} from "./normalize";
import {
  CURATED_FALLBACK_EPISODES,
  CURATED_TITLES,
  fetchTmdbEpisodes,
  fetchTmdbFallback,
  getCuratedFallbackSections,
} from "./tmdb";
import { TokenBroker } from "./token-broker";
import { imdbGraphql, searchSuggestions } from "./transport";
import { getCacheConfig, withCache } from "./cache";
import type {
  CatalogHome,
  CatalogPage,
  EpisodePage,
  MediaDetails,
  MediaSection,
  MediaSummary,
} from "../../src/shared/media";

export { TokenBroker };

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

function jsonResponse(data: unknown, status = 200, requestId?: string): Response {
  const headers = new Headers(CORS_HEADERS);
  if (status === 429) {
    headers.set("Retry-After", "60");
  }
  if (requestId) {
    headers.set("X-Request-Id", requestId);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function parseLimit(url: URL, fallback = 20, max = 50): number {
  const raw = url.searchParams.get("limit");
  if (raw === null) return fallback;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > max) {
    throw new ResponseError(`limit must be an integer between 1 and ${max}`, 400, "INVALID_LIMIT");
  }
  return num;
}

function parseOptionalNumber(
  url: URL,
  param: string,
  min: number,
  max: number,
  requireInteger = false
): number | undefined {
  const raw = url.searchParams.get(param);
  if (raw === null) return undefined;
  const num = Number(raw);
  if (
    !Number.isFinite(num) ||
    num < min ||
    num > max ||
    (requireInteger && !Number.isInteger(num))
  ) {
    throw new ResponseError(
      `${param} must be a number between ${min} and ${max}`,
      400,
      `INVALID_${param.toUpperCase()}`
    );
  }
  return num;
}

async function handleHomeRoute(
  env: CatalogEnv,
  requestId: string
): Promise<CatalogHome> {
  try {
    const [popularMoviesData, popularTvData] = await Promise.all([
      imdbGraphql<{
        advancedTitleSearch?: {
          edges?: Array<{ node?: { title?: TitleNode } }>;
        };
      }>(env, requestId, DISCOVER_QUERY, {
        first: 12,
        constraints: {
          titleTypeConstraint: { anyTitleTypeIds: ["movie"] },
        },
      }).catch(() => null),
      imdbGraphql<{
        advancedTitleSearch?: {
          edges?: Array<{ node?: { title?: TitleNode } }>;
        };
      }>(env, requestId, DISCOVER_QUERY, {
        first: 12,
        constraints: {
          titleTypeConstraint: { anyTitleTypeIds: ["tvSeries", "tvMiniSeries"] },
        },
      }).catch(() => null),
    ]);

    const movieItems: MediaSummary[] =
      popularMoviesData?.advancedTitleSearch?.edges
        ?.flatMap(({ node }) => (node?.title ? [normalizeMediaSummary(node.title)] : [])) ?? [];

    const tvItems: MediaSummary[] =
      popularTvData?.advancedTitleSearch?.edges
        ?.flatMap(({ node }) => (node?.title ? [normalizeMediaSummary(node.title)] : [])) ?? [];

    const sections: MediaSection[] = [];
    if (movieItems.length > 0) {
      sections.push({ id: "popular-movies", title: "Popular Movies", items: movieItems });
    }
    if (tvItems.length > 0) {
      sections.push({ id: "popular-tv", title: "Popular TV Shows", items: tvItems });
    }

    if (sections.length === 0) {
      // Fallback if IMDb responses were empty or failed
      const fallbackSections = getCuratedFallbackSections();
      const hero = fallbackSections[0]?.items[0] ?? null;
      return {
        hero,
        sections: fallbackSections,
        generatedAt: new Date().toISOString(),
      };
    }

    const heroSummary = sections[0]?.items[0] ?? null;
    let hero = heroSummary;
    if (heroSummary) {
      try {
        const heroData = await imdbGraphql<{ title?: TitleNode | null }>(
          env,
          requestId,
          HERO_ART_QUERY,
          { id: heroSummary.imdbId }
        );
        const backdropUrl = heroData.title ? normalizeBackdrop(heroData.title) : null;
        if (backdropUrl) hero = { ...heroSummary, backdropUrl };
      } catch {
        // The poster remains a usable fallback when optional hero art fails.
      }
    }
    return {
      hero,
      sections,
      generatedAt: new Date().toISOString(),
    };
  } catch {
    const fallbackSections = getCuratedFallbackSections();
    return {
      hero: fallbackSections[0]?.items[0] ?? null,
      sections: fallbackSections,
      generatedAt: new Date().toISOString(),
    };
  }
}

async function handleSearchRoute(url: URL): Promise<CatalogPage<MediaSummary>> {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    throw new ResponseError("q is required", 400, "MISSING_QUERY");
  }
  if (query.length > 100) {
    throw new ResponseError("q cannot exceed 100 characters", 400, "QUERY_TOO_LONG");
  }

  const requestedType = url.searchParams.get("type");
  if (requestedType && requestedType !== "movie" && requestedType !== "tv") {
    throw new ResponseError("type must be 'movie' or 'tv'", 400, "INVALID_MEDIA_TYPE");
  }

  const limit = parseLimit(url, 10, 50);
  const items = await searchSuggestions(query);

  const results: MediaSummary[] = items
    .map(normalizeSuggestionItem)
    .filter((item): item is MediaSummary => {
      if (!item) return false;
      if (requestedType && item.mediaType !== requestedType) return false;
      return true;
    })
    .slice(0, limit);

  return {
    results,
    nextCursor: null,
  };
}

async function handleDiscoverRoute(
  url: URL,
  env: CatalogEnv,
  requestId: string
): Promise<CatalogPage<MediaSummary>> {
  const mediaType = url.searchParams.get("type") ?? "movie";
  if (mediaType !== "movie" && mediaType !== "tv") {
    throw new ResponseError("type must be 'movie' or 'tv'", 400, "INVALID_MEDIA_TYPE");
  }

  const limit = parseLimit(url, 20, 50);
  const cursor = url.searchParams.get("cursor") || url.searchParams.get("after") || null;
  const genre = url.searchParams.get("genre")?.trim();
  const minRating = parseOptionalNumber(url, "minRating", 0, 10);
  const minVotes = parseOptionalNumber(url, "minVotes", 0, 10_000_000, true);

  const constraints: Record<string, unknown> = {
    titleTypeConstraint: {
      anyTitleTypeIds: mediaType === "movie" ? ["movie"] : ["tvSeries", "tvMiniSeries"],
    },
  };

  if (genre) {
    constraints.genreConstraint = { anyGenreIds: [genre] };
  }

  if (minRating !== undefined || minVotes !== undefined) {
    constraints.userRatingsConstraint = {
      ...(minRating !== undefined ? { aggregateRatingRange: { min: minRating } } : {}),
      ...(minVotes !== undefined ? { ratingsCountRange: { min: minVotes } } : {}),
    };
  }

  try {
    const data = await imdbGraphql<{
      advancedTitleSearch?: {
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
        edges?: Array<{ cursor?: string; node?: { title?: TitleNode } }>;
      };
    }>(env, requestId, DISCOVER_QUERY, {
      first: limit,
      after: cursor,
      constraints,
    });

    const results: MediaSummary[] =
      data.advancedTitleSearch?.edges?.flatMap(({ node }) =>
        node?.title ? [normalizeMediaSummary(node.title)] : []
      ) ?? [];

    const pageInfo = data.advancedTitleSearch?.pageInfo;
    const nextCursor = pageInfo?.hasNextPage && pageInfo?.endCursor ? pageInfo.endCursor : null;

    return {
      results,
      nextCursor,
    };
  } catch (err) {
    // If upstream IMDb fails, provide fallback titles
    const curatedMatches = Object.values(CURATED_TITLES)
      .filter((m) => m.mediaType === mediaType)
      .map(({ overview, cast, trailer, similar, seasons, countries, languages, metacriticScore, runtimeMinutes, releaseDate, certification, ...summary }) => summary);

    if (curatedMatches.length > 0) {
      return {
        results: curatedMatches.slice(0, limit),
        nextCursor: null,
      };
    }

    throw err;
  }
}

async function handleTitleRoute(
  imdbId: string,
  env: CatalogEnv,
  requestId: string
): Promise<MediaDetails> {
  if (!/^tt\d{7,10}$/.test(imdbId)) {
    throw new ResponseError("Invalid IMDb ID format", 400, "INVALID_IMDB_ID");
  }

  const tmdbFallbackPromise = fetchTmdbFallback(imdbId, env).catch(() => null);

  try {
    const [titleData, tmdbFallback] = await Promise.all([
      imdbGraphql<{ title?: TitleNode | null }>(
        env,
        requestId,
        TITLE_DETAIL_QUERY,
        { id: imdbId, castFirst: 15, similarFirst: 12 }
      ),
      tmdbFallbackPromise,
    ]);

    if (!titleData.title) {
      if (CURATED_TITLES[imdbId]) {
        return CURATED_TITLES[imdbId];
      }
      throw new ResponseError("Title not found", 404, "NOT_FOUND");
    }

    return normalizeTitleDetail(titleData.title, tmdbFallback ?? undefined);
  } catch (error) {
    if (error instanceof ResponseError) throw error;

    // Check curated offline catalog on upstream error
    if (CURATED_TITLES[imdbId]) {
      return CURATED_TITLES[imdbId];
    }

    // Check TMDB fallback alone
    const tmdbFallback = await tmdbFallbackPromise;
    if (tmdbFallback && tmdbFallback.overview) {
      const basicTitle: TitleNode = {
        id: imdbId,
        titleText: { text: imdbId },
      };
      return normalizeTitleDetail(basicTitle, tmdbFallback);
    }

    throw error;
  }
}

async function handleEpisodesRoute(
  imdbId: string,
  seasonStr: string | null,
  env: CatalogEnv,
  requestId: string
): Promise<EpisodePage> {
  if (!/^tt\d{7,10}$/.test(imdbId)) {
    throw new ResponseError("Invalid IMDb ID format", 400, "INVALID_IMDB_ID");
  }

  const season = Number(seasonStr);
  if (!seasonStr || !Number.isInteger(season) || season < 1) {
    throw new ResponseError("season must be an integer >= 1", 400, "INVALID_SEASON");
  }

  const tmdbEpisodesPromise = fetchTmdbEpisodes(imdbId, season, env).catch(() => null);

  try {
    const [episodesData, tmdbEpisodes] = await Promise.all([
      imdbGraphql<{ title?: TitleNode | null }>(
        env,
        requestId,
        EPISODES_QUERY,
        { id: imdbId, first: 100, filter: { includeSeasons: [String(season)] } }
      ),
      tmdbEpisodesPromise,
    ]);

    const fallbackKey = `${imdbId}:${season}`;
    const curatedEpisodes = CURATED_FALLBACK_EPISODES[fallbackKey];
    const fallbackList = tmdbEpisodes ?? curatedEpisodes;

    if (!episodesData?.title) {
      if (fallbackList && fallbackList.length > 0) {
        return {
          seriesId: imdbId,
          season,
          results: fallbackList,
          nextCursor: null,
        };
      }
      throw new ResponseError("Series not found or has no episodes", 404, "NOT_FOUND");
    }

    return normalizeEpisodes(episodesData.title, season, fallbackList);
  } catch (error) {
    if (error instanceof ResponseError) throw error;

    const fallbackKey = `${imdbId}:${season}`;
    const curatedEpisodes = CURATED_FALLBACK_EPISODES[fallbackKey];
    const tmdbEpisodes = await tmdbEpisodesPromise;
    const fallbackList = tmdbEpisodes ?? curatedEpisodes;

    if (fallbackList && fallbackList.length > 0) {
      return {
        seriesId: imdbId,
        season,
        results: fallbackList,
        nextCursor: null,
      };
    }

    throw error;
  }
}

export async function handleCatalogRequest(
  request: Request,
  env: CatalogEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);
  const requestId =
    request.headers.get("cf-ray") ??
    request.headers.get("x-request-id") ??
    crypto.randomUUID();

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method !== "GET") {
    return jsonResponse(
      { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }, requestId },
      405,
      requestId
    );
  }

  // Normalize path by stripping /~/+ proxy mount prefix if present
  const pathname = url.pathname.replace(/^\/~\/\+/, "");

  try {
    // Per-client rate limiting support if binding configured
    if (env.API_RATE_LIMITER) {
      const clientIp =
        request.headers.get("cf-connecting-ip") ??
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "global";
      const rlResult = await env.API_RATE_LIMITER.limit({ key: `catalog:${clientIp}` });
      if (!rlResult.success) {
        throw new ResponseError("Rate limit exceeded", 429, "RATE_LIMIT_EXCEEDED");
      }
    }

    const cacheConfig = getCacheConfig(pathname);

    // Route: /api/catalog/home
    if (pathname === "/api/catalog/home") {
      return await withCache(request, ctx, cacheConfig, async () => {
        const homeData = await handleHomeRoute(env, requestId);
        return jsonResponse(homeData, 200, requestId);
      });
    }

    // Route: /api/catalog/search
    if (pathname === "/api/catalog/search") {
      return await withCache(request, ctx, cacheConfig, async () => {
        const searchData = await handleSearchRoute(url);
        return jsonResponse(searchData, 200, requestId);
      });
    }

    // Route: /api/catalog/discover
    if (pathname === "/api/catalog/discover") {
      return await withCache(request, ctx, cacheConfig, async () => {
        const discoverData = await handleDiscoverRoute(url, env, requestId);
        return jsonResponse(discoverData, 200, requestId);
      });
    }

    // Route: /api/catalog/title/:imdbId/episodes (or /api/catalog/episodes/:imdbId/:season)
    const titleEpisodesMatch = pathname.match(/^\/api\/catalog\/title\/([^/]+)\/episodes$/);
    if (titleEpisodesMatch) {
      const imdbId = titleEpisodesMatch[1];
      const seasonStr = url.searchParams.get("season");
      return await withCache(request, ctx, cacheConfig, async () => {
        const episodeData = await handleEpisodesRoute(imdbId, seasonStr, env, requestId);
        return jsonResponse(episodeData, 200, requestId);
      });
    }

    const pathEpisodesMatch = pathname.match(/^\/api\/catalog\/episodes\/([^/]+)\/([^/]+)$/);
    if (pathEpisodesMatch) {
      const [, imdbId, seasonStr] = pathEpisodesMatch;
      return await withCache(request, ctx, cacheConfig, async () => {
        const episodeData = await handleEpisodesRoute(imdbId, seasonStr, env, requestId);
        return jsonResponse(episodeData, 200, requestId);
      });
    }

    // Route: /api/catalog/title/:imdbId
    const titleMatch = pathname.match(/^\/api\/catalog\/title\/([^/]+)$/);
    if (titleMatch) {
      const imdbId = titleMatch[1];
      return await withCache(request, ctx, cacheConfig, async () => {
        const titleData = await handleTitleRoute(imdbId, env, requestId);
        return jsonResponse(titleData, 200, requestId);
      });
    }

    throw new ResponseError("Not found", 404, "NOT_FOUND");
  } catch (error) {
    const status =
      error instanceof ResponseError
        ? error.status
        : error instanceof UpstreamError
        ? error.status
        : 500;

    const code =
      error instanceof ResponseError
        ? error.code
        : error instanceof UpstreamError
        ? error.code
        : "INTERNAL_ERROR";

    const message = error instanceof Error ? error.message : String(error);

    console.error(
      JSON.stringify({
        event: "catalog.request.error",
        requestId,
        path: pathname,
        status,
        code,
        error: message,
      })
    );

    return jsonResponse(
      {
        error: message,
        code,
        requestId,
      },
      status,
      requestId
    );
  }
}
