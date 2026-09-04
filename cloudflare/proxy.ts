export interface ProxyEnv {
  UPSTREAM_ORIGIN: string
  UPSTREAM_ORIGINS?: string
  UPSTREAM_PREFIX: string
}

const IMMUTABLE_ASSET = /\/assets\/.+\.[a-z0-9]{8,}\.(?:css|js|woff2?|png|jpe?g|webp|avif|svg)$/i

export function prefixedPath(prefix: string, pathname: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, "")
  const normalized = trimmed ? `/${trimmed}` : ""
  if (!normalized) return pathname || "/"
  if (pathname === normalized || pathname.startsWith(`${normalized}/`)) {
    return pathname
  }
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`
  return cleanPath === "/" ? `${normalized}/` : `${normalized}${cleanPath}`
}

function upstreamUrl(requestUrl: string, origin: string, env: ProxyEnv): URL {
  const incoming = new URL(requestUrl)
  const upstream = new URL(origin)
  upstream.pathname = prefixedPath(env.UPSTREAM_PREFIX, incoming.pathname)
  upstream.search = incoming.search
  return upstream
}

function upstreamReferer(value: string, publicOrigin: string, origin: string, env: ProxyEnv): string {
  try {
    const referer = new URL(value)
    if (referer.origin !== publicOrigin) return value
    const upstream = new URL(origin)
    referer.protocol = upstream.protocol
    referer.host = upstream.host
    referer.pathname = prefixedPath(env.UPSTREAM_PREFIX, referer.pathname)
    return referer.toString()
  } catch {
    return value
  }
}

function publicLocation(value: string, incoming: URL, origin: string, env: ProxyEnv): string {
  try {
    const upstreamOrigin = new URL(origin).origin
    const location = new URL(value, upstreamOrigin)
    const prefix = env.UPSTREAM_PREFIX === "/" ? "" : `/${env.UPSTREAM_PREFIX.replace(/^\/+|\/+$/g, "")}`
    if (location.origin !== upstreamOrigin) return value
    if (prefix && location.pathname !== prefix && !location.pathname.startsWith(`${prefix}/`)) return value
    location.protocol = incoming.protocol
    location.host = incoming.host
    location.pathname = prefix ? location.pathname.slice(prefix.length) || "/" : location.pathname
    return location.toString()
  } catch {
    return value
  }
}

function configuredOrigins(env: ProxyEnv): string[] {
  const configured = (env.UPSTREAM_ORIGINS || env.UPSTREAM_ORIGIN)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const origins = [...new Set(configured.map((value) => new URL(value).origin))]
  if (origins.length === 0) throw new Error("No Hawk upstream origin is configured")
  return origins
}

function score(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function hashFromPath(pathname: string): string | null {
  return pathname.match(/\/(?:playback|torrents|stream)\/([a-f0-9]{40})(?:\/|$)/i)?.[1]?.toLowerCase() ?? null
}

async function requestAffinity(request: Request, requestId: string): Promise<{ key: string; stateful: boolean }> {
  const incoming = new URL(request.url)
  const pathHash = hashFromPath(incoming.pathname)
  if (pathHash) return { key: pathHash, stateful: true }

  if (request.method === "POST" && /\/api\/(?:playback|torrents)$/.test(incoming.pathname)) {
    try {
      const payload = await request.clone().json() as { magnet?: unknown; source?: { magnet?: unknown } }
      const magnet = typeof payload.source?.magnet === "string"
        ? payload.source.magnet
        : typeof payload.magnet === "string" ? payload.magnet : ""
      const magnetHash = magnet.match(/urn:btih:([a-f0-9]{40})/i)?.[1]?.toLowerCase()
      if (magnetHash) return { key: magnetHash, stateful: true }
    } catch {
      // The application backend owns request-body validation.
    }
  }

  return { key: request.headers.get("cf-connecting-ip") ?? requestId, stateful: false }
}

export async function orderedOrigins(request: Request, env: ProxyEnv, requestId: string): Promise<{
  origins: string[]
  stateful: boolean
}> {
  const { key, stateful } = await requestAffinity(request, requestId)
  const origins = configuredOrigins(env).sort((left, right) => score(`${key}:${right}`) - score(`${key}:${left}`))
  return { origins, stateful }
}

function cacheProperties(request: Request, incoming: URL): RequestInitCfProperties {
  if (request.method === "GET" && IMMUTABLE_ASSET.test(incoming.pathname)) {
    return { cacheEverything: true, cacheTtl: 31_536_000 }
  }
  return { cacheEverything: false }
}

export async function proxyRequest(request: Request, env: ProxyEnv, requestId: string): Promise<Response> {
  const startedAt = Date.now()
  const incoming = new URL(request.url)

  try {
    const { origins, stateful } = await orderedOrigins(request, env, requestId)
    let upstream: Response | null = null
    let selectedOrigin = origins[0]
    let lastError: unknown

    for (const origin of origins) {
      const headers = new Headers(request.headers)
      headers.set("x-forwarded-host", incoming.host)
      headers.set("x-forwarded-proto", incoming.protocol.slice(0, -1))
      headers.set("x-hawk-request-id", requestId)
      if (headers.has("origin")) headers.set("origin", origin)
      const referer = headers.get("referer")
      if (referer) headers.set("referer", upstreamReferer(referer, incoming.origin, origin, env))

      try {
        const candidate = await fetch(new Request(upstreamUrl(request.url, origin, env), request), {
          headers,
          redirect: "manual",
          cf: cacheProperties(request, incoming),
        })
        upstream = candidate
        selectedOrigin = origin
        if (stateful || ![502, 503, 504].includes(candidate.status)) break
        await candidate.body?.cancel()
      } catch (error) {
        lastError = error
        if (stateful) throw error
      }
    }

    if (!upstream) throw lastError ?? new Error("No Hawk upstream responded")
    const responseHeaders = new Headers(upstream.headers)
    const location = responseHeaders.get("location")
    if (location) responseHeaders.set("location", publicLocation(location, incoming, selectedOrigin, env))

    const cookies = upstream.headers.getSetCookie()
    if (cookies.length) {
      responseHeaders.delete("set-cookie")
      for (const cookie of cookies) {
        responseHeaders.append("set-cookie", cookie.replace(/Path=\/~\/+\/?/gi, "Path=/"))
      }
    }
    responseHeaders.set("x-hawk-request-id", requestId)
    if (IMMUTABLE_ASSET.test(incoming.pathname)) {
      responseHeaders.set("cache-control", "public, max-age=31536000, immutable")
    }

    console.log(JSON.stringify({
      event: "proxy_request",
      requestId,
      method: request.method,
      path: incoming.pathname,
      status: upstream.status,
      origin: new URL(selectedOrigin).host,
      stateful,
      durationMs: Date.now() - startedAt,
    }))
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    })
  } catch (error) {
    console.error(JSON.stringify({
      event: "proxy_error",
      requestId,
      method: request.method,
      path: incoming.pathname,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }))
    return Response.json(
      { error: "Hawk is temporarily unavailable.", requestId },
      { status: 502, headers: { "cache-control": "no-store", "x-hawk-request-id": requestId } },
    )
  }
}
