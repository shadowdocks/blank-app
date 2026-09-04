import { useCallback, useSyncExternalStore } from "react"

import {
  addHistory as addHistoryToStore,
  clearHistory as clearHistoryInStore,
  DEFAULT_STORE,
  getStorageSnapshot,
  removeBookmark as removeBookmarkFromStore,
  removeDownloadedMetadata as removeDownloadedFromStore,
  removeHistory as removeHistoryFromStore,
  saveDownloadedMetadata as saveDownloadedToStore,
  subscribeStorage,
  toggleBookmark as toggleBookmarkInStore,
  updatePreferences as updatePreferencesInStore,
  type DownloadedMetaRecord,
  type HawkStore,
  type UserPreferences,
} from "@/lib/storage"
import type { MediaSummary } from "../../shared/media"
import type { PlaybackRecord } from "../../shared/playback"

export function useLibrary() {
  const store: HawkStore = useSyncExternalStore(
    subscribeStorage,
    getStorageSnapshot,
    () => DEFAULT_STORE
  )

  const isBookmarked = useCallback(
    (imdbId: string) => {
      return store.bookmarks.some((b) => b.imdbId.toLowerCase() === imdbId.toLowerCase())
    },
    [store.bookmarks]
  )

  const toggleBookmark = useCallback((media: MediaSummary) => {
    return toggleBookmarkInStore(media)
  }, [])

  const removeBookmark = useCallback((imdbId: string) => {
    removeBookmarkFromStore(imdbId)
  }, [])

  const addHistory = useCallback((record: PlaybackRecord) => {
    addHistoryToStore(record)
  }, [])

  const removeHistory = useCallback((imdbId: string, season: number | null = null, episode: number | null = null) => {
    removeHistoryFromStore(imdbId, season, episode)
  }, [])

  const clearHistory = useCallback(() => {
    clearHistoryInStore()
  }, [])

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    updatePreferencesInStore(patch)
  }, [])

  const saveDownloaded = useCallback((meta: DownloadedMetaRecord) => {
    saveDownloadedToStore(meta)
  }, [])

  const removeDownloaded = useCallback((id: string) => {
    removeDownloadedFromStore(id)
  }, [])

  return {
    bookmarks: store.bookmarks,
    history: store.history,
    progress: store.progress,
    downloaded: store.downloadedMetadata,
    recentSearches: store.recentSearches,
    preferences: store.preferences,
    isBookmarked,
    toggleBookmark,
    removeBookmark,
    addHistory,
    removeHistory,
    clearHistory,
    updatePreferences,
    saveDownloaded,
    removeDownloaded,
  }
}
