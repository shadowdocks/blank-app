import { useSyncExternalStore } from "react"

import type { MediaType } from "../../shared/media"

/**
 * History API routing for Hawk.
 *
 * Supported routes:
 *   /                                          home
 *   /search                                    search
 *   /title/:imdbId                             title details
 *   /watch/:imdbId                             watch movie
 *   /watch/:imdbId/:season/:episode            watch episode
 *   /library                                   saved library
 *
 * Legacy picker and app URLs normalize to the nearest current route.
 *
 * Mount-aware for:
 *   - Root mount: "/"
 *   - Streamlit cloud / local: "/~/+/"
 *   - Arbitrary nested mount: e.g. "/subpath/"
 */

export interface HomeRoute {
  name: "home"
}

export interface SearchRoute {
  name: "search"
  query?: string
}

export interface TitleRoute {
  name: "title"
  id: string
  imdbId?: string
  type: MediaType
}

export interface WatchMovieRoute {
  name: "watch"
  imdbId: string
  season?: null | undefined
  episode?: null | undefined
}

export interface WatchEpisodeRoute {
  name: "watch"
  imdbId: string
  season: number
  episode: number
}

export type WatchRoute = WatchMovieRoute | WatchEpisodeRoute

export interface LibraryRoute {
  name: "library"
}

export type Route =
  | HomeRoute
  | SearchRoute
  | TitleRoute
  | WatchRoute
  | LibraryRoute

const MOUNT_MARKER = "/~/+/"
const ROUTE_TAIL = /(?:\/|^)(?:search|library|title\/[^/]+|watch\/[^/]+(?:\/[^/]+\/[^/]+)?|app\/(?:movie|tv)\/[^/]+(?:\/sources)?)\/?$/

let customMount: string | null = null
let cachedMount: string | null = null

export function setMountBase(mount: string | null): void {
  customMount = mount
  cachedMount = null
  cachedSnapshotPath = null
}

/**
 * Detects the mount base from a pathname (defaulting to window.location.pathname).
 * Always returns a prefix ending with a slash, e.g. "/" or "/~/+/" or "/hawk/".
 */
export function detectMount(pathname?: string): string {
  if (customMount !== null) {
    const trimmed = customMount.replace(/\/+$/, "")
    return trimmed ? `${trimmed}/` : "/"
  }

  const path = pathname ?? (typeof window !== "undefined" && window.location ? window.location.pathname : "/")
  const marker = path.indexOf(MOUNT_MARKER)
  if (marker >= 0) {
    return path.slice(0, marker + MOUNT_MARKER.length)
  }

  const trimmed = path.replace(ROUTE_TAIL, "/") || "/"
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

export function mountBase(): string {
  if (cachedMount !== null) return cachedMount
  cachedMount = detectMount()
  return cachedMount
}

/**
 * Turns a mount-relative path into an absolute pathname for fetch or asset URLs.
 * e.g. mountPath("api/catalog/home") -> "/api/catalog/home" or "/~/+/api/catalog/home"
 */
export function mountPath(path: string): string {
  const base = mountBase()
  const clean = path.replace(/^\/+/, "")
  return `${base}${clean}`
}

export function mountAsset(path: string): string {
  return mountPath(path)
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function isMediaType(value: string | undefined): value is MediaType {
  return value === "movie" || value === "tv"
}

export function parseRoute(pathname?: string, base?: string): Route {
  const mount = base ?? mountBase()
  const path = pathname ?? (typeof window !== "undefined" && window.location ? window.location.pathname : "/")
  const rest = path.startsWith(mount) ? path.slice(mount.length) : path.replace(/^\/+/, "")
  const segments = rest.split("/").filter(Boolean).map(decode)

  if (segments.length === 0) return { name: "home" }

  const [head, second, third, fourth, ...extra] = segments
  if (extra.length > 0) return { name: "home" }

  if (head === "search" && !second) {
    return { name: "search" }
  }

  if (head === "library" && !second) {
    return { name: "library" }
  }

  if (head === "title" && second && !third) {
    return { name: "title", imdbId: second, id: second, type: "movie" }
  }

  if (head === "watch" && second) {
    if (!third) {
      return { name: "watch", imdbId: second }
    }
    if (third && fourth && !segments[4]) {
      const season = parseInt(third, 10)
      const episode = parseInt(fourth, 10)
      if (Number.isFinite(season) && Number.isFinite(episode)) {
        return { name: "watch", imdbId: second, season, episode }
      }
    }
  }

  if (head === "pick" && !second) {
    return { name: "home" }
  }

  if (head === "app" && isMediaType(second) && third) {
    if (!fourth) {
      return { name: "title", imdbId: third, id: third, type: second }
    }
    if (fourth === "sources" && !segments[4]) {
      return { name: "title", imdbId: third, type: second, id: third }
    }
  }

  return { name: "home" }
}

export function toPath(route: Route, base?: string): string {
  const mount = base ?? mountBase()
  switch (route.name) {
    case "home":
      return mount
    case "search":
      return `${mount}search`
    case "library":
      return `${mount}library`
    case "title": {
      const id = route.imdbId || route.id || ""
      return `${mount}title/${encodeURIComponent(id)}`
    }
    case "watch": {
      const id = route.imdbId
      if (typeof route.season === "number" && typeof route.episode === "number") {
        return `${mount}watch/${encodeURIComponent(id)}/${route.season}/${route.episode}`
      }
      return `${mount}watch/${encodeURIComponent(id)}`
    }
    default:
      return mount
  }
}

/* -------------------------------------------------------------------------- */
/* Navigation & Reactivity                                                    */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>()
let cachedSnapshotPath: string | null = null
let snapshot: Route = { name: "home" }

function getSnapshot(): Route {
  if (typeof window === "undefined" || !window.location) return { name: "home" }
  const path = window.location.pathname
  if (path !== cachedSnapshotPath) {
    cachedSnapshotPath = path
    snapshot = parseRoute(path)
  }
  return snapshot
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", onChange)
  }
  return () => {
    listeners.delete(onChange)
    if (typeof window !== "undefined") {
      window.removeEventListener("popstate", onChange)
    }
  }
}

export function navigate(route: Route, options?: { replace?: boolean }): void {
  const path = toPath(route)
  const replace = options?.replace ?? false
  if (typeof window !== "undefined" && window.location && window.history) {
    if (path === window.location.pathname && !replace) return
    if (replace) window.history.replaceState(null, "", path)
    else window.history.pushState(null, "", path)
  }
  cachedSnapshotPath = path
  snapshot = route
  for (const listener of listeners) listener()
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot, () => ({ name: "home" }))
}
