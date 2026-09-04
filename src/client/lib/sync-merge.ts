import type { PlaybackRecord } from "../../shared/playback"
import type { HawkSyncedState } from "./account-types"
import {
  DEFAULT_PREFERENCES,
  historyRecordKey,
  sanitizeSyncableState,
  type MediaBookmark,
  type PlaybackProgress,
  type UserPreferences,
} from "./storage"

function bookmarkKey(b: MediaBookmark): string {
  const id = b.imdbId || (b as unknown as { id?: string }).id || ""
  return id.trim().toLowerCase()
}

function bookmarksEqual(a: MediaBookmark, b: MediaBookmark): boolean {
  return (
    bookmarkKey(a) === bookmarkKey(b) &&
    a.title === b.title &&
    a.mediaType === b.mediaType &&
    a.year === b.year &&
    a.rating === b.rating &&
    a.posterUrl === b.posterUrl &&
    a.backdropUrl === b.backdropUrl &&
    a.bookmarkedAt === b.bookmarkedAt
  )
}

function historyEqual(a: PlaybackRecord, b: PlaybackRecord): boolean {
  return (
    historyRecordKey(a) === historyRecordKey(b) &&
    a.positionSeconds === b.positionSeconds &&
    a.durationSeconds === b.durationSeconds &&
    a.updatedAt === b.updatedAt
  )
}

function progressEqual(a: PlaybackProgress, b: PlaybackProgress): boolean {
  return (
    a.id === b.id &&
    a.positionSeconds === b.positionSeconds &&
    a.durationSeconds === b.durationSeconds &&
    a.progressFraction === b.progressFraction &&
    a.completed === b.completed &&
    a.updatedAt === b.updatedAt
  )
}

function parseTime(isoString?: string | null): number {
  if (!isoString) return 0
  const parsed = Date.parse(isoString)
  return Number.isFinite(parsed) ? parsed : 0
}

export function mergeBookmarks(
  baseList: MediaBookmark[],
  localList: MediaBookmark[],
  remoteList: MediaBookmark[]
): MediaBookmark[] {
  const baseMap = new Map<string, MediaBookmark>()
  for (const b of baseList) baseMap.set(bookmarkKey(b), b)

  const localMap = new Map<string, MediaBookmark>()
  for (const b of localList) localMap.set(bookmarkKey(b), b)

  const remoteMap = new Map<string, MediaBookmark>()
  for (const b of remoteList) remoteMap.set(bookmarkKey(b), b)

  const allKeys = new Set<string>([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ])

  const result: MediaBookmark[] = []

  for (const key of allKeys) {
    const baseItem = baseMap.get(key)
    const localItem = localMap.get(key)
    const remoteItem = remoteMap.get(key)

    const localChanged = !baseItem
      ? !!localItem
      : !localItem || !bookmarksEqual(baseItem, localItem)
    const remoteChanged = !baseItem
      ? !!remoteItem
      : !remoteItem || !bookmarksEqual(baseItem, remoteItem)

    if (!localChanged && !remoteChanged) {
      if (baseItem) result.push(baseItem)
    } else if (localChanged && !remoteChanged) {
      // Local changed only (including deletion if !localItem)
      if (localItem) result.push(localItem)
    } else if (!localChanged && remoteChanged) {
      // Remote changed only (including deletion if !remoteItem)
      if (remoteItem) result.push(remoteItem)
    } else {
      // Both changed!
      if (!localItem && !remoteItem) {
        // Both deleted
        continue
      } else if (localItem && !remoteItem) {
        // Local modified or added, remote deleted
        result.push(localItem)
      } else if (!localItem && remoteItem) {
        // Remote modified or added, local deleted
        result.push(remoteItem)
      } else if (localItem && remoteItem) {
        // Both present: prefer item with later ISO timestamp (bookmarkedAt)
        const localTime = parseTime(localItem.bookmarkedAt)
        const remoteTime = parseTime(remoteItem.bookmarkedAt)
        result.push(localTime >= remoteTime ? localItem : remoteItem)
      }
    }
  }

  result.sort((a, b) => parseTime(b.bookmarkedAt) - parseTime(a.bookmarkedAt))
  return result
}

export function mergeHistory(
  baseList: PlaybackRecord[],
  localList: PlaybackRecord[],
  remoteList: PlaybackRecord[]
): PlaybackRecord[] {
  const baseMap = new Map<string, PlaybackRecord>()
  for (const h of baseList) baseMap.set(historyRecordKey(h), h)

  const localMap = new Map<string, PlaybackRecord>()
  for (const h of localList) localMap.set(historyRecordKey(h), h)

  const remoteMap = new Map<string, PlaybackRecord>()
  for (const h of remoteList) remoteMap.set(historyRecordKey(h), h)

  const allKeys = new Set<string>([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ])

  const result: PlaybackRecord[] = []

  for (const key of allKeys) {
    const baseItem = baseMap.get(key)
    const localItem = localMap.get(key)
    const remoteItem = remoteMap.get(key)

    const localChanged = !baseItem
      ? !!localItem
      : !localItem || !historyEqual(baseItem, localItem)
    const remoteChanged = !baseItem
      ? !!remoteItem
      : !remoteItem || !historyEqual(baseItem, remoteItem)

    if (!localChanged && !remoteChanged) {
      if (baseItem) result.push(baseItem)
    } else if (localChanged && !remoteChanged) {
      if (localItem) result.push(localItem)
    } else if (!localChanged && remoteChanged) {
      if (remoteItem) result.push(remoteItem)
    } else {
      if (!localItem && !remoteItem) {
        continue
      } else if (localItem && !remoteItem) {
        result.push(localItem)
      } else if (!localItem && remoteItem) {
        result.push(remoteItem)
      } else if (localItem && remoteItem) {
        // Prefer later ISO timestamp (updatedAt)
        const localTime = parseTime(localItem.updatedAt)
        const remoteTime = parseTime(remoteItem.updatedAt)
        result.push(localTime >= remoteTime ? localItem : remoteItem)
      }
    }
  }

  result.sort((a, b) => parseTime(b.updatedAt) - parseTime(a.updatedAt))
  return result
}

export function mergeProgress(
  baseProgress: Record<string, PlaybackProgress>,
  localProgress: Record<string, PlaybackProgress>,
  remoteProgress: Record<string, PlaybackProgress>
): Record<string, PlaybackProgress> {
  const allKeys = new Set<string>([
    ...Object.keys(baseProgress),
    ...Object.keys(localProgress),
    ...Object.keys(remoteProgress),
  ])

  const result: Record<string, PlaybackProgress> = {}

  for (const key of allKeys) {
    const baseItem = baseProgress[key]
    const localItem = localProgress[key]
    const remoteItem = remoteProgress[key]

    const localChanged = !baseItem
      ? !!localItem
      : !localItem || !progressEqual(baseItem, localItem)
    const remoteChanged = !baseItem
      ? !!remoteItem
      : !remoteItem || !progressEqual(baseItem, remoteItem)

    if (!localChanged && !remoteChanged) {
      if (baseItem) result[key] = baseItem
    } else if (localChanged && !remoteChanged) {
      if (localItem) result[key] = localItem
    } else if (!localChanged && remoteChanged) {
      if (remoteItem) result[key] = remoteItem
    } else {
      if (!localItem && !remoteItem) {
        continue
      } else if (localItem && !remoteItem) {
        result[key] = localItem
      } else if (!localItem && remoteItem) {
        result[key] = remoteItem
      } else if (localItem && remoteItem) {
        // Prefer later ISO timestamp (updatedAt)
        const localTime = parseTime(localItem.updatedAt)
        const remoteTime = parseTime(remoteItem.updatedAt)
        result[key] = localTime >= remoteTime ? localItem : remoteItem
      }
    }
  }

  return result
}

export function mergePreferences(
  base: UserPreferences,
  local: UserPreferences,
  remote: UserPreferences
): UserPreferences {
  const fields: (keyof UserPreferences)[] = [
    "audioLanguage",
    "subtitleLanguage",
    "subtitlesEnabled",
    "autoResume",
    "autoplay",
    "defaultQuality",
    "theme",
  ]

  const result: UserPreferences = { ...DEFAULT_PREFERENCES }

  for (const field of fields) {
    const isDirty = local[field] !== base[field]
    if (isDirty) {
      // Local changed this field -> local wins
      ;(result as unknown as Record<keyof UserPreferences, unknown>)[field] = local[field]
    } else {
      // Local did not change this field -> remote wins
      ;(result as unknown as Record<keyof UserPreferences, unknown>)[field] =
        remote[field] ?? base[field]
    }
  }

  return result
}

export function threeWayMerge(
  base: HawkSyncedState,
  local: HawkSyncedState,
  remote: HawkSyncedState
): HawkSyncedState {
  const mergedBookmarks = mergeBookmarks(base.bookmarks, local.bookmarks, remote.bookmarks)
  const mergedHistory = mergeHistory(base.history, local.history, remote.history)
  const mergedProgress = mergeProgress(base.progress, local.progress, remote.progress)
  const mergedPreferences = mergePreferences(base.preferences, local.preferences, remote.preferences)

  return sanitizeSyncableState({
    bookmarks: mergedBookmarks,
    history: mergedHistory,
    progress: mergedProgress,
    preferences: mergedPreferences,
  })
}

export function areSyncedStatesEqual(a: HawkSyncedState, b: HawkSyncedState): boolean {
  if (a.bookmarks.length !== b.bookmarks.length) return false
  if (a.history.length !== b.history.length) return false
  if (Object.keys(a.progress).length !== Object.keys(b.progress).length) return false

  const aBookmarksMap = new Map<string, MediaBookmark>()
  for (const bm of a.bookmarks) aBookmarksMap.set(bookmarkKey(bm), bm)
  for (const bm of b.bookmarks) {
    const match = aBookmarksMap.get(bookmarkKey(bm))
    if (!match || !bookmarksEqual(match, bm)) return false
  }

  const aHistoryMap = new Map<string, PlaybackRecord>()
  for (const h of a.history) aHistoryMap.set(historyRecordKey(h), h)
  for (const h of b.history) {
    const match = aHistoryMap.get(historyRecordKey(h))
    if (!match || !historyEqual(match, h)) return false
  }

  for (const key of Object.keys(a.progress)) {
    const pA = a.progress[key]
    const pB = b.progress[key]
    if (!pB || !progressEqual(pA, pB)) return false
  }

  const prefs: (keyof UserPreferences)[] = [
    "audioLanguage",
    "subtitleLanguage",
    "subtitlesEnabled",
    "autoResume",
    "autoplay",
    "defaultQuality",
    "theme",
  ]
  for (const field of prefs) {
    if (a.preferences[field] !== b.preferences[field]) return false
  }

  return true
}
