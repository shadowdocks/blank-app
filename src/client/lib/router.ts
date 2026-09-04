import { useSyncExternalStore } from "react"

import type { MediaType, Title } from "@/lib/types"

/**
 * History API routing. Every browser-visible path is mount-relative:
 *
 *   /                       picker
 *   /search                 search
 *   /app/:type/:id          selected title
 *   /app/:type/:id/sources  source picker
 *   /watch/:infoHash        watch
 *
 * Behind Streamlit the same paths sit under /~/+/. No hash is ever read or
 * written.
 */
export interface TitleRoute {
  name: "title"
  type: MediaType
  id: string
}

export type Route =
  | { name: "pick" }
  | { name: "search" }
  | TitleRoute
  | { name: "sources"; type: MediaType; id: string }
  | { name: "watch"; infoHash: string }

export const STEPS = ["pick", "title", "sources", "watch"] as const

export type Step = (typeof STEPS)[number]

export const STEP_LABELS: Record<Step, string> = {
  pick: "Mood",
  title: "Title",
  sources: "Sources",
  watch: "Watch",
}

const PICK: Route = { name: "pick" }

/** Streamlit always mounts a custom app here; local dev serves it from "/". */
const MOUNT_MARKER = "/~/+/"

/** Every route tail, so the mount can be recovered outside Streamlit too. */
const ROUTE_TAIL = /(?:^|\/)(?:search|app\/(?:movie|tv)\/[^/]+(?:\/sources)?|watch\/[^/]+)\/?$/

let cachedMount: string | null = null

/**
 * The prefix Hawk is served from, always with a trailing slash: "/" locally,
 * "/~/+/" behind Streamlit. Derived from the current path rather than a build
 * constant, so the same bundle works in both places.
 */
export function mountBase(): string {
  if (cachedMount !== null) return cachedMount
  const path = window.location.pathname
  const marker = path.indexOf(MOUNT_MARKER)
  if (marker >= 0) {
    cachedMount = path.slice(0, marker + MOUNT_MARKER.length)
    return cachedMount
  }
  const trimmed = path.replace(ROUTE_TAIL, "/") || "/"
  cachedMount = trimmed.endsWith("/") ? trimmed : `${trimmed}/`
  return cachedMount
}

/** Turns a mount-relative path such as "api/search" into a full path. */
export function mountPath(path: string): string {
  return `${mountBase()}${path.replace(/^\/+/, "")}`
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

export function parseRoute(pathname: string = window.location.pathname): Route {
  const mount = mountBase()
  const rest = pathname.startsWith(mount) ? pathname.slice(mount.length) : pathname
  const [head, second, third, fourth, ...extra] = rest.split("/").filter(Boolean).map(decode)

  if (!head) return PICK
  if (extra.length) return PICK
  if (head === "search" && !second) return { name: "search" }
  if (head === "watch" && second && !third) return { name: "watch", infoHash: second }
  if (head === "app" && isMediaType(second) && third) {
    if (!fourth) return { name: "title", type: second, id: third }
    if (fourth === "sources") return { name: "sources", type: second, id: third }
  }
  return PICK
}

export function toPath(route: Route): string {
  const mount = mountBase()
  switch (route.name) {
    case "search":
      return `${mount}search`
    case "title":
      return `${mount}app/${route.type}/${encodeURIComponent(route.id)}`
    case "sources":
      return `${mount}app/${route.type}/${encodeURIComponent(route.id)}/sources`
    case "watch":
      return `${mount}watch/${encodeURIComponent(route.infoHash)}`
    default:
      return mount
  }
}

export function stepOf(route: Route): Step | null {
  switch (route.name) {
    case "pick":
      return "pick"
    case "title":
      return "title"
    case "sources":
      return "sources"
    case "watch":
      return "watch"
    default:
      // Search is not a step in the mood-to-watch flow, so it shows no trail.
      return null
  }
}

/* -------------------------------------------------------------------------- */
/* Title identity                                                             */
/* -------------------------------------------------------------------------- */

/** TMDB sends numbers, the IMDb fallback sends "tt..." strings. */
export function titleIdOf(title: Title): string | null {
  if (title.id === null || title.id === undefined) return null
  const value = String(title.id).trim()
  return value ? value : null
}

export function titleTypeOf(title: Title, fallback: MediaType): MediaType {
  return isMediaType(title.mediaType ?? undefined) ? (title.mediaType as MediaType) : fallback
}

export function titleRoute(title: Title, fallback: MediaType): TitleRoute | null {
  const id = titleIdOf(title)
  if (!id) return null
  return { name: "title", type: titleTypeOf(title, fallback), id }
}

export function titleMatches(
  title: Title,
  type: MediaType,
  id: string,
  fallback: MediaType
): boolean {
  return titleIdOf(title)?.toLowerCase() === id.toLowerCase() && titleTypeOf(title, fallback) === type
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                 */
/* -------------------------------------------------------------------------- */

const listeners = new Set<() => void>()

let snapshotPath: string | null = null
let snapshot: Route = PICK

function getSnapshot(): Route {
  const path = window.location.pathname
  if (path !== snapshotPath) {
    snapshotPath = path
    snapshot = parseRoute(path)
  }
  return snapshot
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("popstate", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("popstate", onChange)
  }
}

export function navigate(route: Route, options?: { replace?: boolean }): void {
  const path = toPath(route)
  const replace = options?.replace ?? false
  if (path === window.location.pathname && !replace) return
  if (replace) window.history.replaceState(null, "", path)
  else window.history.pushState(null, "", path)
  for (const listener of listeners) listener()
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, getSnapshot)
}
