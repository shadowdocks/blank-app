import type { MediaSummary, MediaType } from "../../shared/media"
import type { PlaybackRecord, VideoQuality } from "../../shared/playback"
import type { HawkSyncedState, SyncMetadata } from "./account-types"

export const STORE_KEY = "hawk.store.v3"
export const SYNC_META_KEY = "hawk.sync_meta.v1"
export const LEGACY_SESSION_KEY = "hawk.session.v2"
export const LEGACY_SEARCHES_KEY = "hawk.searches.v1"

export const MAX_BOOKMARKS = 200
export const MAX_HISTORY = 100
export const MAX_PROGRESS = 200
export const MAX_RECENT_SEARCHES = 10
export const MAX_DOWNLOADED_METADATA = 100

export interface MediaBookmark {
  imdbId: string
  mediaType: MediaType
  title: string
  year: number | null
  rating: number | null
  posterUrl: string | null
  backdropUrl: string | null
  genres: string[]
  bookmarkedAt: string
}

export interface PlaybackProgress {
  id: string
  imdbId: string
  mediaType: MediaType
  season: number | null
  episode: number | null
  positionSeconds: number
  durationSeconds: number
  progressFraction: number
  completed: boolean
  updatedAt: string
}

export interface UserPreferences {
  audioLanguage: string
  subtitleLanguage: string
  subtitlesEnabled: boolean
  autoResume: boolean
  autoplay: boolean
  defaultQuality: VideoQuality
  theme: "dark" | "light" | "system"
}

export interface DownloadedMetaRecord {
  id: string
  imdbId: string
  mediaType: MediaType
  title: string
  season: number | null
  episode: number | null
  sizeBytes: number
  downloadedAt: string
  completed: boolean
  posterUrl: string | null
}

export interface HawkStore {
  version: 3
  bookmarks: MediaBookmark[]
  history: PlaybackRecord[]
  progress: Record<string, PlaybackProgress>
  recentSearches: string[]
  preferences: UserPreferences
  downloadedMetadata: DownloadedMetaRecord[]
}

export const DEFAULT_PREFERENCES: Readonly<UserPreferences> = Object.freeze({
  audioLanguage: "en",
  subtitleLanguage: "en",
  subtitlesEnabled: false,
  autoResume: true,
  autoplay: true,
  defaultQuality: "1080p",
  theme: "dark",
})

export const DEFAULT_STORE: Readonly<HawkStore> = Object.freeze({
  version: 3,
  bookmarks: Object.freeze([]) as unknown as MediaBookmark[],
  history: Object.freeze([]) as unknown as PlaybackRecord[],
  progress: Object.freeze({}) as unknown as Record<string, PlaybackProgress>,
  recentSearches: Object.freeze([]) as unknown as string[],
  preferences: DEFAULT_PREFERENCES as UserPreferences,
  downloadedMetadata: Object.freeze([]) as unknown as DownloadedMetaRecord[],
})

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/* -------------------------------------------------------------------------- */
/* Validation & Normalization                                                 */
/* -------------------------------------------------------------------------- */

function sanitizeBookmark(item: unknown): MediaBookmark | null {
  const obj = record(item)
  if (!obj) return null
  const imdbId = text(obj.imdbId) || text(obj.id)
  const title = text(obj.title)
  if (!imdbId || !title) return null
  const mediaType: MediaType = obj.mediaType === "tv" ? "tv" : "movie"
  return {
    imdbId,
    mediaType,
    title,
    year: num(obj.year),
    rating: num(obj.rating),
    posterUrl: text(obj.posterUrl),
    backdropUrl: text(obj.backdropUrl),
    genres: Array.isArray(obj.genres)
      ? obj.genres.filter((g): g is string => typeof g === "string")
      : [],
    bookmarkedAt: text(obj.bookmarkedAt) ?? new Date().toISOString(),
  }
}

export function historyRecordKey(record: PlaybackRecord): string {
  const id = record.media.imdbId || record.media.id
  if (record.season !== null && record.episode !== null) {
    return `${id}:s${record.season}:e${record.episode}`
  }
  return id
}

function sanitizeHistory(item: unknown): PlaybackRecord | null {
  const obj = record(item)
  if (!obj) return null
  const mediaObj = record(obj.media)
  if (!mediaObj) return null
  const title = text(mediaObj.title)
  const id = text(mediaObj.id) || text(mediaObj.imdbId)
  if (!title || !id) return null

  const media: MediaSummary = {
    id,
    imdbId: text(mediaObj.imdbId) ?? (id.startsWith("tt") ? id : null),
    tmdbId: num(mediaObj.tmdbId),
    mediaType: mediaObj.mediaType === "tv" ? "tv" : "movie",
    title,
    originalTitle: text(mediaObj.originalTitle),
    year: num(mediaObj.year),
    endYear: num(mediaObj.endYear),
    rating: num(mediaObj.rating),
    voteCount: num(mediaObj.voteCount),
    genres: Array.isArray(mediaObj.genres)
      ? mediaObj.genres.filter((g): g is string => typeof g === "string")
      : [],
    posterUrl: text(mediaObj.posterUrl),
    backdropUrl: text(mediaObj.backdropUrl),
  }

  return {
    media,
    season: num(obj.season),
    episode: num(obj.episode),
    positionSeconds: num(obj.positionSeconds) ?? 0,
    durationSeconds: num(obj.durationSeconds) ?? 0,
    updatedAt: text(obj.updatedAt) ?? new Date().toISOString(),
  }
}

function sanitizeProgress(item: unknown): PlaybackProgress | null {
  const obj = record(item)
  if (!obj) return null
  const imdbId = text(obj.imdbId) || text(obj.id)
  if (!imdbId) return null
  const season = num(obj.season)
  const episode = num(obj.episode)
  const positionSeconds = num(obj.positionSeconds) ?? 0
  const durationSeconds = num(obj.durationSeconds) ?? 0
  const progressFraction = durationSeconds > 0 ? positionSeconds / durationSeconds : 0
  const id = text(obj.id) ?? (season !== null && episode !== null ? `${imdbId}:s${season}:e${episode}` : imdbId)

  return {
    id,
    imdbId,
    mediaType: obj.mediaType === "tv" ? "tv" : "movie",
    season,
    episode,
    positionSeconds,
    durationSeconds,
    progressFraction: Math.max(0, Math.min(1, progressFraction)),
    completed: Boolean(obj.completed) || progressFraction >= 0.9,
    updatedAt: text(obj.updatedAt) ?? new Date().toISOString(),
  }
}

function sanitizePreferences(raw: unknown): UserPreferences {
  const obj = record(raw) ?? {}
  const validThemes = new Set(["dark", "light", "system"])
  const validQualities = new Set(["2160p", "1440p", "1080p", "720p", "480p", "unknown"])

  return {
    audioLanguage: text(obj.audioLanguage) ?? DEFAULT_PREFERENCES.audioLanguage,
    subtitleLanguage: text(obj.subtitleLanguage) ?? DEFAULT_PREFERENCES.subtitleLanguage,
    subtitlesEnabled: typeof obj.subtitlesEnabled === "boolean" ? obj.subtitlesEnabled : DEFAULT_PREFERENCES.subtitlesEnabled,
    autoResume: typeof obj.autoResume === "boolean" ? obj.autoResume : DEFAULT_PREFERENCES.autoResume,
    autoplay: typeof obj.autoplay === "boolean" ? obj.autoplay : DEFAULT_PREFERENCES.autoplay,
    defaultQuality: validQualities.has(String(obj.defaultQuality))
      ? (obj.defaultQuality as VideoQuality)
      : DEFAULT_PREFERENCES.defaultQuality,
    theme: validThemes.has(String(obj.theme))
      ? (obj.theme as "dark" | "light" | "system")
      : DEFAULT_PREFERENCES.theme,
  }
}

function sanitizeDownloaded(item: unknown): DownloadedMetaRecord | null {
  const obj = record(item)
  if (!obj) return null
  const id = text(obj.id)
  const imdbId = text(obj.imdbId)
  const title = text(obj.title)
  if (!id || !imdbId || !title) return null

  return {
    id,
    imdbId,
    mediaType: obj.mediaType === "tv" ? "tv" : "movie",
    title,
    season: num(obj.season),
    episode: num(obj.episode),
    sizeBytes: num(obj.sizeBytes) ?? 0,
    downloadedAt: text(obj.downloadedAt) ?? new Date().toISOString(),
    completed: Boolean(obj.completed),
    posterUrl: text(obj.posterUrl),
  }
}

function parseStore(raw: string): HawkStore {
  try {
    const data = record(JSON.parse(raw))
    if (!data) return DEFAULT_STORE

    const bookmarks = Array.isArray(data.bookmarks)
      ? data.bookmarks.map(sanitizeBookmark).filter((b): b is MediaBookmark => b !== null).slice(0, MAX_BOOKMARKS)
      : []

    const history = Array.isArray(data.history)
      ? data.history.map(sanitizeHistory).filter((h): h is PlaybackRecord => h !== null).slice(0, MAX_HISTORY)
      : []

    const progress: Record<string, PlaybackProgress> = {}
    if (data.progress && typeof data.progress === "object") {
      for (const [key, val] of Object.entries(data.progress)) {
        const item = sanitizeProgress(val)
        if (item) progress[key] = item
      }
    }

    const recentSearches = Array.isArray(data.recentSearches)
      ? data.recentSearches
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, MAX_RECENT_SEARCHES)
      : []

    const preferences = sanitizePreferences(data.preferences)

    const downloadedMetadata = Array.isArray(data.downloadedMetadata)
      ? data.downloadedMetadata
          .map(sanitizeDownloaded)
          .filter((d): d is DownloadedMetaRecord => d !== null)
          .slice(0, MAX_DOWNLOADED_METADATA)
      : []

    return {
      version: 3,
      bookmarks,
      history,
      progress,
      recentSearches,
      preferences,
      downloadedMetadata,
    }
  } catch {
    return DEFAULT_STORE
  }
}

/* -------------------------------------------------------------------------- */
/* Migration from Legacy hawk.session.v2 and hawk.searches.v1                 */
/* -------------------------------------------------------------------------- */

export function migrateFromLegacy(): HawkStore {
  const store: HawkStore = {
    version: 3,
    bookmarks: [],
    history: [],
    progress: {},
    recentSearches: [],
    preferences: { ...DEFAULT_PREFERENCES },
    downloadedMetadata: [],
  }

  if (typeof window === "undefined" || !window.localStorage) {
    return store
  }

  // 1. Searches
  try {
    const rawSearches = window.localStorage.getItem(LEGACY_SEARCHES_KEY)
    if (rawSearches) {
      const parsed = JSON.parse(rawSearches) as unknown
      if (Array.isArray(parsed)) {
        store.recentSearches = parsed
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .slice(0, MAX_RECENT_SEARCHES)
      }
    }
  } catch {
    // ignore
  }

  // 2. Session
  try {
    const rawSession = window.localStorage.getItem(LEGACY_SESSION_KEY)
    if (rawSession) {
      const session = record(JSON.parse(rawSession))
      if (session) {
        if (Array.isArray(session.titles)) {
          for (const item of session.titles) {
            const obj = record(item)
            if (obj && text(obj.title) && (text(obj.id) || num(obj.id))) {
              const id = String(obj.id)
              store.bookmarks.push({
                imdbId: id,
                mediaType: obj.mediaType === "tv" ? "tv" : "movie",
                title: String(obj.title),
                year: num(obj.year),
                rating: num(obj.rating),
                posterUrl: text(obj.posterUrl),
                backdropUrl: text(obj.backdropUrl),
                genres: Array.isArray(obj.genres)
                  ? obj.genres.filter((g): g is string => typeof g === "string")
                  : [],
                bookmarkedAt: new Date().toISOString(),
              })
            }
          }
          store.bookmarks = store.bookmarks.slice(0, MAX_BOOKMARKS)
        }

        if (session.torrent) {
          const torrent = record(session.torrent)
          const origin = torrent ? record(torrent.origin) : null
          if (torrent && origin && text(origin.id) && text(torrent.name)) {
            const id = String(origin.id)
            const type: MediaType = origin.type === "tv" ? "tv" : "movie"
            store.history.push({
              media: {
                id,
                imdbId: id.startsWith("tt") ? id : null,
                tmdbId: null,
                mediaType: type,
                title: String(torrent.name),
                originalTitle: null,
                year: null,
                endYear: null,
                rating: null,
                voteCount: null,
                genres: [],
                posterUrl: null,
                backdropUrl: null,
              },
              season: null,
              episode: null,
              positionSeconds: 0,
              durationSeconds: 0,
              updatedAt: new Date().toISOString(),
            })
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return store
}

/* -------------------------------------------------------------------------- */
/* Store Access, Persistence, & Events                                       */
/* -------------------------------------------------------------------------- */

let cachedStore: HawkStore | null = null
const storeListeners = new Set<() => void>()

export function clearStorageCache(): void {
  cachedStore = null
}

function notifyListeners(): void {
  for (const fn of storeListeners) fn()
}

export function subscribeStorage(callback: () => void): () => void {
  storeListeners.add(callback)
  let onStorage: ((e: StorageEvent) => void) | null = null

  if (typeof window !== "undefined") {
    onStorage = (e: StorageEvent) => {
      if (e.key === STORE_KEY || e.key === null) {
        cachedStore = null
        callback()
      }
    }
    window.addEventListener("storage", onStorage)
  }

  return () => {
    storeListeners.delete(callback)
    if (typeof window !== "undefined" && onStorage) {
      window.removeEventListener("storage", onStorage)
    }
  }
}

export function getStorageSnapshot(): HawkStore {
  if (cachedStore !== null) return cachedStore
  cachedStore = loadStore()
  return cachedStore
}

export function loadStore(): HawkStore {
  if (typeof window === "undefined" || !window.localStorage) {
    return DEFAULT_STORE
  }

  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw) {
      return parseStore(raw)
    }

    // Check if migration is possible
    const hasLegacySession = window.localStorage.getItem(LEGACY_SESSION_KEY)
    const hasLegacySearches = window.localStorage.getItem(LEGACY_SEARCHES_KEY)
    if (hasLegacySession || hasLegacySearches) {
      const migrated = migrateFromLegacy()
      saveStore(migrated)
      return migrated
    }

    return DEFAULT_STORE
  } catch {
    return DEFAULT_STORE
  }
}

export function saveStore(store: HawkStore): void {
  const bounded: HawkStore = {
    ...store,
    bookmarks: store.bookmarks.slice(0, MAX_BOOKMARKS),
    history: store.history.slice(0, MAX_HISTORY),
    recentSearches: store.recentSearches.slice(0, MAX_RECENT_SEARCHES),
    downloadedMetadata: store.downloadedMetadata.slice(0, MAX_DOWNLOADED_METADATA),
  }
  cachedStore = bounded
  if (typeof window === "undefined" || !window.localStorage) {
    notifyListeners()
    return
  }

  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(bounded))
  } catch {
    // Quota or private mode
  }
  notifyListeners()
}

/* -------------------------------------------------------------------------- */
/* Bounded Operations                                                         */
/* -------------------------------------------------------------------------- */

export function getBookmarks(): MediaBookmark[] {
  return getStorageSnapshot().bookmarks
}

export function isBookmarked(imdbId: string): boolean {
  return getStorageSnapshot().bookmarks.some((b) => b.imdbId.toLowerCase() === imdbId.toLowerCase())
}

export function toggleBookmark(media: MediaSummary): boolean {
  const store = getStorageSnapshot()
  const id = media.imdbId || media.id
  const exists = store.bookmarks.some((b) => b.imdbId.toLowerCase() === id.toLowerCase())

  if (exists) {
    const nextBookmarks = store.bookmarks.filter((b) => b.imdbId.toLowerCase() !== id.toLowerCase())
    saveStore({ ...store, bookmarks: nextBookmarks })
    return false
  }

  const newBookmark: MediaBookmark = {
    imdbId: id,
    mediaType: media.mediaType,
    title: media.title,
    year: media.year,
    rating: media.rating,
    posterUrl: media.posterUrl,
    backdropUrl: media.backdropUrl,
    genres: media.genres,
    bookmarkedAt: new Date().toISOString(),
  }

  const nextBookmarks = [newBookmark, ...store.bookmarks].slice(0, MAX_BOOKMARKS)
  saveStore({ ...store, bookmarks: nextBookmarks })
  return true
}

export function removeBookmark(imdbId: string): void {
  const store = getStorageSnapshot()
  const nextBookmarks = store.bookmarks.filter((b) => b.imdbId.toLowerCase() !== imdbId.toLowerCase())
  saveStore({ ...store, bookmarks: nextBookmarks })
}

export function getHistory(): PlaybackRecord[] {
  return getStorageSnapshot().history
}

export function addHistory(record: PlaybackRecord): void {
  const store = getStorageSnapshot()
  const key = historyRecordKey(record)
  const filtered = store.history.filter((h) => historyRecordKey(h) !== key)
  const nextHistory = [{ ...record, updatedAt: new Date().toISOString() }, ...filtered].slice(0, MAX_HISTORY)
  saveStore({ ...store, history: nextHistory })
}

export function removeHistory(imdbId: string, season: number | null = null, episode: number | null = null): void {
  const store = getStorageSnapshot()
  const targetKey = season !== null && episode !== null ? `${imdbId}:s${season}:e${episode}` : imdbId
  const nextHistory = store.history.filter((h) => historyRecordKey(h) !== targetKey)
  saveStore({ ...store, history: nextHistory })
}

export function clearHistory(): void {
  const store = getStorageSnapshot()
  saveStore({ ...store, history: [] })
}

export function getProgress(imdbId: string, season: number | null = null, episode: number | null = null): PlaybackProgress | null {
  const store = getStorageSnapshot()
  const key = season !== null && episode !== null ? `${imdbId}:s${season}:e${episode}` : imdbId
  return store.progress[key] ?? null
}

export function savePlaybackProgress(input: {
  imdbId: string
  mediaType: MediaType
  season?: number | null
  episode?: number | null
  positionSeconds: number
  durationSeconds: number
}): void {
  const store = getStorageSnapshot()
  const season = input.season ?? null
  const episode = input.episode ?? null
  const key = season !== null && episode !== null ? `${input.imdbId}:s${season}:e${episode}` : input.imdbId
  const progressFraction = input.durationSeconds > 0 ? input.positionSeconds / input.durationSeconds : 0

  const entry: PlaybackProgress = {
    id: key,
    imdbId: input.imdbId,
    mediaType: input.mediaType,
    season,
    episode,
    positionSeconds: input.positionSeconds,
    durationSeconds: input.durationSeconds,
    progressFraction: Math.max(0, Math.min(1, progressFraction)),
    completed: progressFraction >= 0.9,
    updatedAt: new Date().toISOString(),
  }

  const nextProgress = { ...store.progress, [key]: entry }
  const keys = Object.keys(nextProgress)
  if (keys.length > MAX_PROGRESS) {
    // Evict oldest by updatedAt
    const sorted = keys.sort((a, b) => nextProgress[a].updatedAt.localeCompare(nextProgress[b].updatedAt))
    for (let i = 0; i < sorted.length - MAX_PROGRESS; i++) {
      delete nextProgress[sorted[i]]
    }
  }

  saveStore({ ...store, progress: nextProgress })
}

export function clearPlaybackProgress(imdbId: string, season: number | null = null, episode: number | null = null): void {
  const store = getStorageSnapshot()
  const key = season !== null && episode !== null ? `${imdbId}:s${season}:e${episode}` : imdbId
  if (!store.progress[key]) return
  const nextProgress = { ...store.progress }
  delete nextProgress[key]
  saveStore({ ...store, progress: nextProgress })
}

export function getPreferences(): UserPreferences {
  return getStorageSnapshot().preferences
}

export function updatePreferences(patch: Partial<UserPreferences>): void {
  const store = getStorageSnapshot()
  const preferences = sanitizePreferences({ ...store.preferences, ...patch })
  saveStore({ ...store, preferences })
}

export function getDownloadedMetadata(): DownloadedMetaRecord[] {
  return getStorageSnapshot().downloadedMetadata
}

export function saveDownloadedMetadata(meta: DownloadedMetaRecord): void {
  const store = getStorageSnapshot()
  const filtered = store.downloadedMetadata.filter((d) => d.id !== meta.id)
  const next = [meta, ...filtered].slice(0, MAX_DOWNLOADED_METADATA)
  saveStore({ ...store, downloadedMetadata: next })
}

export function removeDownloadedMetadata(id: string): void {
  const store = getStorageSnapshot()
  const next = store.downloadedMetadata.filter((d) => d.id !== id)
  saveStore({ ...store, downloadedMetadata: next })
}

export function loadRecentSearches(): string[] {
  try {
    const storeSearches = getStorageSnapshot().recentSearches
    if (storeSearches.length > 0) return storeSearches

    if (typeof window === "undefined" || !window.localStorage) return []
    const raw = window.localStorage.getItem(LEGACY_SEARCHES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES)
  } catch {
    return []
  }
}

export function saveRecentSearch(query: string): string[] {
  const value = query.trim()
  if (!value) return loadRecentSearches()

  const store = getStorageSnapshot()
  const filtered = store.recentSearches.filter((item) => item.toLowerCase() !== value.toLowerCase())
  const next = [value, ...filtered].slice(0, MAX_RECENT_SEARCHES)

  saveStore({ ...store, recentSearches: next })

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LEGACY_SEARCHES_KEY, JSON.stringify(next))
    }
  } catch {
    // ignore
  }

  return next
}

export function clearRecentSearches(): void {
  const store = getStorageSnapshot()
  saveStore({ ...store, recentSearches: [] })

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(LEGACY_SEARCHES_KEY)
    }
  } catch {
    // ignore
  }
}

/* -------------------------------------------------------------------------- */
/* Syncable State Extraction, Replacement & Metadata Persistence              */
/* -------------------------------------------------------------------------- */

export function sanitizeSyncableState(data: unknown): HawkSyncedState {
  const obj = record(data)
  if (!obj) {
    return {
      bookmarks: [],
      history: [],
      progress: {},
      preferences: { ...DEFAULT_PREFERENCES },
    }
  }

  const bookmarks = Array.isArray(obj.bookmarks)
    ? obj.bookmarks.map(sanitizeBookmark).filter((b): b is MediaBookmark => b !== null).slice(0, MAX_BOOKMARKS)
    : []

  const history = Array.isArray(obj.history)
    ? obj.history.map(sanitizeHistory).filter((h): h is PlaybackRecord => h !== null).slice(0, MAX_HISTORY)
    : []

  const progress: Record<string, PlaybackProgress> = {}
  if (obj.progress && typeof obj.progress === "object") {
    for (const [key, val] of Object.entries(obj.progress)) {
      const item = sanitizeProgress(val)
      if (item && Object.keys(progress).length < MAX_PROGRESS) {
        progress[key] = item
      }
    }
  }

  const preferences = sanitizePreferences(obj.preferences)

  return {
    bookmarks,
    history,
    progress,
    preferences,
  }
}

export function extractSyncableState(store: HawkStore = getStorageSnapshot()): HawkSyncedState {
  return {
    bookmarks: store.bookmarks.slice(0, MAX_BOOKMARKS),
    history: store.history.slice(0, MAX_HISTORY),
    progress: { ...store.progress },
    preferences: { ...store.preferences },
  }
}

export function replaceSyncableState(
  syncedState: HawkSyncedState,
  options?: { preservePreferences?: boolean }
): HawkStore {
  const current = getStorageSnapshot()
  const sanitized = sanitizeSyncableState(syncedState)
  const next: HawkStore = {
    ...current,
    bookmarks: sanitized.bookmarks,
    history: sanitized.history,
    progress: sanitized.progress,
    preferences: options?.preservePreferences ? { ...current.preferences } : sanitized.preferences,
    recentSearches: current.recentSearches.slice(0, MAX_RECENT_SEARCHES),
    downloadedMetadata: current.downloadedMetadata.slice(0, MAX_DOWNLOADED_METADATA),
  }
  saveStore(next)
  return next
}

export function clearSyncableState(options?: { preservePreferences?: boolean }): HawkStore {
  const current = getStorageSnapshot()
  const next: HawkStore = {
    ...current,
    bookmarks: [],
    history: [],
    progress: {},
    preferences: options?.preservePreferences ? { ...current.preferences } : { ...DEFAULT_PREFERENCES },
    recentSearches: current.recentSearches.slice(0, MAX_RECENT_SEARCHES),
    downloadedMetadata: current.downloadedMetadata.slice(0, MAX_DOWNLOADED_METADATA),
  }
  saveStore(next)
  return next
}

export function getSyncMetadata(): SyncMetadata | null {
  if (typeof window === "undefined" || !window.localStorage) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(SYNC_META_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.userId === "string" &&
      typeof parsed.serverRevision === "number" &&
      parsed.baseState &&
      typeof parsed.baseState === "object"
    ) {
      return {
        userId: parsed.userId,
        serverRevision: parsed.serverRevision,
        baseState: sanitizeSyncableState(parsed.baseState),
      }
    }
    return null
  } catch {
    return null
  }
}

export function saveSyncMetadata(metadata: SyncMetadata): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return
  }
  try {
    const clean: SyncMetadata = {
      userId: metadata.userId,
      serverRevision: metadata.serverRevision,
      baseState: sanitizeSyncableState(metadata.baseState),
    }
    window.localStorage.setItem(SYNC_META_KEY, JSON.stringify(clean))
  } catch {
    // ignore
  }
}

export function clearSyncMetadata(): void {
  if (typeof window === "undefined" || !window.localStorage) {
    return
  }
  try {
    window.localStorage.removeItem(SYNC_META_KEY)
  } catch {
    // ignore
  }
}
