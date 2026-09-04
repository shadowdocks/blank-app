import { MOOD_IDS, TIME_IDS, TYPE_IDS } from "@/lib/options"
import type {
  ActiveTorrent,
  MediaType,
  Session,
  Source,
  TimeBucket,
  Title,
  TorrentOrigin,
} from "@/lib/types"

const KEY = "hawk.session.v2"
const SEARCHES_KEY = "hawk.searches.v1"
const MAX_SEARCHES = 6

export const DEFAULT_SESSION: Session = {
  mood: "cozy",
  type: "movie",
  time: "standard",
  titles: [],
  sources: [],
  sourcesFor: null,
  selectedMagnet: null,
  torrent: null,
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

function toTitle(value: unknown): Title | null {
  const item = record(value)
  const title = item && text(item.title)
  if (!item || !title) return null
  return {
    id: typeof item.id === "number" ? item.id : text(item.id),
    mediaType: item.mediaType === "tv" || item.mediaType === "movie" ? item.mediaType : null,
    title,
    year: text(item.year),
    overview: text(item.overview),
    rating: typeof item.rating === "number" ? item.rating : null,
    runtime: typeof item.runtime === "number" ? item.runtime : null,
    genres: Array.isArray(item.genres) ? item.genres.filter((g): g is string => typeof g === "string") : [],
    posterUrl: text(item.posterUrl),
    backdropUrl: text(item.backdropUrl),
  }
}

function toSource(value: unknown): Source | null {
  const item = record(value)
  const magnet = item && text(item.magnet)
  const name = item && text(item.name)
  if (!item || !magnet || !name) return null
  return {
    name,
    magnet,
    seeds: Number(item.seeds) || 0,
    leeches: Number(item.leeches) || 0,
    size: text(item.size) ?? "Unknown size",
    source: text(item.source) ?? "unknown",
    hash: text(item.hash) ?? undefined,
  }
}

function toOrigin(value: unknown): TorrentOrigin | null {
  const item = record(value)
  const id = item && text(item.id)
  if (!item || !id) return null
  if (item.type !== "movie" && item.type !== "tv") return null
  return { type: item.type, id }
}

function toTorrent(value: unknown): ActiveTorrent | null {
  const item = record(value)
  const infoHash = item && text(item.infoHash)
  const magnet = item && text(item.magnet)
  if (!item || !infoHash || !magnet) return null
  return {
    infoHash,
    magnet,
    video: typeof item.video === "number" ? item.video : null,
    name: text(item.name) ?? "Stream",
    origin: toOrigin(item.origin),
  }
}

function parse(raw: string): Session {
  const stored = record(JSON.parse(raw) as unknown)
  if (!stored) return DEFAULT_SESSION

  const titles = Array.isArray(stored.titles)
    ? stored.titles.map(toTitle).filter((item): item is Title => item !== null)
    : []
  const sources = Array.isArray(stored.sources)
    ? stored.sources.map(toSource).filter((item): item is Source => item !== null)
    : []

  const session: Session = {
    mood: MOOD_IDS.has(String(stored.mood)) ? String(stored.mood) : DEFAULT_SESSION.mood,
    type: TYPE_IDS.has(String(stored.type)) ? (stored.type as MediaType) : DEFAULT_SESSION.type,
    time: TIME_IDS.has(String(stored.time)) ? (stored.time as TimeBucket) : DEFAULT_SESSION.time,
    titles,
    sources,
    sourcesFor: text(stored.sourcesFor),
    selectedMagnet: text(stored.selectedMagnet),
    torrent: toTorrent(stored.torrent),
  }
  if (session.selectedMagnet && !sources.some((item) => item.magnet === session.selectedMagnet)) {
    session.selectedMagnet = sources[0]?.magnet ?? null
  }
  return session
}

/** Recovery data only; the URL decides which screen and title are shown. */
export function loadSession(): Session {
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? parse(raw) : DEFAULT_SESSION
  } catch {
    return DEFAULT_SESSION
  }
}

export function saveSession(session: Session): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // Private-mode or quota failures must not break playback.
  }
}

export function loadRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(SEARCHES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_SEARCHES)
  } catch {
    return []
  }
}

/** Returns the new list so the caller can render it without a second read. */
export function saveRecentSearch(query: string): string[] {
  const value = query.trim()
  if (!value) return loadRecentSearches()
  const next = [value, ...loadRecentSearches().filter((item) => item !== value)].slice(
    0,
    MAX_SEARCHES
  )
  try {
    window.localStorage.setItem(SEARCHES_KEY, JSON.stringify(next))
  } catch {
    // Nothing to do; recent searches are a convenience.
  }
  return next
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(SEARCHES_KEY)
  } catch {
    // Nothing to do.
  }
}
