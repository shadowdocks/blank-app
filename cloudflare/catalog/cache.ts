import type { ExecutionContext } from "./env";

const CATALOG_CACHE_VERSION = "5";

export interface CacheConfig {
  ttlSeconds: number;
  swrSeconds: number;
}

export function getCacheConfig(pathname: string): CacheConfig {
  if (pathname === "/api/catalog/search") {
    return { ttlSeconds: 600, swrSeconds: 300 };
  }
  if (pathname === "/api/catalog/discover" || pathname === "/api/catalog/home") {
    return { ttlSeconds: 900, swrSeconds: 300 };
  }
  return { ttlSeconds: 21_600, swrSeconds: 3_600 };
}

async function getCache(): Promise<{
  match(req: Request | string): Promise<Response | undefined>;
  put(req: Request | string, res: Response): Promise<void>;
} | null> {
  if (typeof caches === "undefined") return null;
  try {
    // caches.default is present in Cloudflare Worker runtime
    if ("default" in caches && (caches as any).default) {
      return (caches as any).default;
    }
    if (typeof caches.open === "function") {
      return await caches.open("imdb-catalog-v1");
    }
  } catch {
    // Ignored in runtimes without cache storage
  }
  return null;
}

async function putInCache(
  cache: { put(req: Request | string, res: Response): Promise<void> },
  cacheKey: Request,
  response: Response,
  config: CacheConfig
): Promise<void> {
  const cacheHeaders = new Headers(response.headers);
  cacheHeaders.set(
    "Cache-Control",
    `public, max-age=${config.ttlSeconds}, stale-while-revalidate=${config.swrSeconds}`
  );
  cacheHeaders.set("X-Created-At", String(Date.now()));

  const cachedResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: cacheHeaders,
  });

  await cache.put(cacheKey, cachedResponse);
}

export async function withCache(
  request: Request,
  ctx: ExecutionContext | undefined,
  config: CacheConfig,
  fetcher: () => Promise<Response>
): Promise<Response> {
  const cache = await getCache();
  if (!cache) {
    const res = await fetcher();
    res.headers.set("X-Cache", "BYPASS");
    return res;
  }

  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set("__hawk_catalog", CATALOG_CACHE_VERSION);
  const cacheKey = new Request(cacheUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const cached = await cache.match(cacheKey);

  if (cached) {
    const createdAt = Number(cached.headers.get("X-Created-At") ?? "0");
    const ageSeconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));

    if (ageSeconds <= config.ttlSeconds) {
      // Fresh cache hit
      const response = new Response(cached.body, cached);
      response.headers.set("Cache-Control", `public, max-age=${config.ttlSeconds}, stale-while-revalidate=${config.swrSeconds}`);
      response.headers.set("X-Cache", "HIT");
      return response;
    }

    if (ageSeconds <= config.ttlSeconds + config.swrSeconds) {
      // Stale while revalidate: return stale now, update cache in background
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(
          fetcher()
            .then(async (freshRes) => {
              if (freshRes.ok) {
                await putInCache(cache, cacheKey, freshRes.clone(), config);
              }
            })
            .catch(() => {})
        );
      }

      const response = new Response(cached.body, cached);
      response.headers.set("Cache-Control", `public, max-age=0, stale-while-revalidate=${config.swrSeconds}`);
      response.headers.set("X-Cache", "STALE");
      return response;
    }
  }

  // Cache miss or expired beyond SWR
  const freshResponse = await fetcher();

  if (freshResponse.ok && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(putInCache(cache, cacheKey, freshResponse.clone(), config));
  }

  freshResponse.headers.set("Cache-Control", `public, max-age=${config.ttlSeconds}, stale-while-revalidate=${config.swrSeconds}`);
  freshResponse.headers.set("X-Cache", "MISS");
  return freshResponse;
}
