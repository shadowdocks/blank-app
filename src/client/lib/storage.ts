import { MOOD_IDS, TIME_IDS, TYPE_IDS } from "@/lib/options"
import { PHASES, phaseFromHash, reachablePhase } from "@/lib/phase"
import type { ActiveTorrent, MediaType, Phase, Session, Source, TimeBucket, Title } from "@/lib/types"

const KEY = "hawk.session.v1"

export const DEFAULT_SESSION: Session = {
  mood: "cozy",
  type: "movie",
  time: "standard",
  titles: [],
  titleIndex: 0,
  sources: [],
  selectedMagnet: null,
  torrent: null,
  phase: "pick",
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
    id: typeof item.id === "number" ? item.id : null,
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
  const index = Number(stored.titleIndex)
  const phase = stored.phase

  const session: Session = {
    mood: MOOD_IDS.has(String(stored.mood)) ? String(stored.mood) : DEFAULT_SESSION.mood,
    type: TYPE_IDS.has(String(stored.type)) ? (stored.type as MediaType) : DEFAULT_SESSION.type,
    time: TIME_IDS.has(String(stored.time)) ? (stored.time as TimeBucket) : DEFAULT_SESSION.time,
    titles,
    titleIndex: Number.isInteger(index) && index >= 0 && index < titles.length ? index : 0,
    sources,
    selectedMagnet: text(stored.selectedMagnet),
    torrent: toTorrent(stored.torrent),
    phase: PHASES.includes(phase as Phase) ? (phase as Phase) : "pick",
  }
  if (session.selectedMagnet && !sources.some((item) => item.magnet === session.selectedMagnet)) {
    session.selectedMagnet = sources[0]?.magnet ?? null
  }
  return session
}

/** Storage plus the URL hash decide the opening phase; the hash wins when valid. */
export function loadSession(): Session {
  let session = DEFAULT_SESSION
  try {
    const raw = window.localStorage.getItem(KEY)
    if (raw) session = parse(raw)
  } catch {
    session = DEFAULT_SESSION
  }
  const requested = phaseFromHash(window.location.hash) ?? session.phase
  return { ...session, phase: reachablePhase(session, requested) }
}

export function saveSession(session: Session): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // Private-mode or quota failures must not break playback.
  }
}
