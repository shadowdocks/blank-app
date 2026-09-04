import { useCallback, useSyncExternalStore } from "react"

import {
  clearPlaybackProgress,
  DEFAULT_STORE,
  getStorageSnapshot,
  savePlaybackProgress,
  subscribeStorage,
  type HawkStore,
  type PlaybackProgress,
} from "@/lib/storage"
import type { MediaType } from "../../shared/media"

export function usePlaybackProgress(
  imdbId: string | null,
  mediaType: MediaType = "movie",
  season: number | null = null,
  episode: number | null = null
) {
  const store: HawkStore = useSyncExternalStore(
    subscribeStorage,
    getStorageSnapshot,
    () => DEFAULT_STORE
  )

  const progressKey = imdbId
    ? season !== null && episode !== null
      ? `${imdbId}:s${season}:e${episode}`
      : imdbId
    : null

  const progress: PlaybackProgress | null = progressKey ? store.progress[progressKey] ?? null : null

  const save = useCallback(
    (positionSeconds: number, durationSeconds: number) => {
      if (!imdbId) return
      savePlaybackProgress({
        imdbId,
        mediaType,
        season,
        episode,
        positionSeconds,
        durationSeconds,
      })
    },
    [imdbId, mediaType, season, episode]
  )

  const clear = useCallback(() => {
    if (!imdbId) return
    clearPlaybackProgress(imdbId, season, episode)
  }, [imdbId, season, episode])

  return {
    progress,
    saveProgress: save,
    clearProgress: clear,
  }
}
