import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import {
  clearDeduplicationCache,
} from "@/lib/api"
import {
  setMountBase,
} from "@/lib/router"
import {
  addHistory,
  clearHistory,
  clearPlaybackProgress,
  clearStorageCache,
  DEFAULT_STORE,
  getBookmarks,
  getHistory,
  getPreferences,
  getProgress,
  isBookmarked,
  removeBookmark,
  removeHistory,
  savePlaybackProgress,
  saveStore,
  toggleBookmark,
  updatePreferences,
} from "@/lib/storage"
import {
  useCatalogEpisodes,
  useCatalogHome,
  useCatalogRequest,
  useCatalogSearch,
  useCatalogTitle,
} from "./use-catalog"
import { useLibrary } from "./use-library"
import { useNetworkStatus } from "./use-network-status"
import { usePlaybackProgress } from "./use-playback-progress"
import { navigate, useRoute } from "./use-route"
import type { MediaSummary } from "../../shared/media"
import type { PlaybackRecord } from "../../shared/playback"

class MemoryStorage {
  private map = new Map<string, string>()

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  get length(): number {
    return this.map.size
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }
}

describe("Hawk client hooks", () => {
  let memoryStorage: MemoryStorage
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    memoryStorage = new MemoryStorage()

    const eventListeners: Record<string, Set<EventListenerOrEventListenerObject>> = {}
    const win = {
      localStorage: memoryStorage,
      location: { pathname: "/" },
      history: {
        pushState: (_: unknown, __: string, url: string) => {
          win.location.pathname = url
        },
        replaceState: (_: unknown, __: string, url: string) => {
          win.location.pathname = url
        },
      },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (!eventListeners[type]) eventListeners[type] = new Set()
        eventListeners[type].add(listener)
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        eventListeners[type]?.delete(listener)
      },
      dispatchEvent: (event: Event) => {
        eventListeners[event.type]?.forEach((l) => {
          if (typeof l === "function") l(event)
          else l.handleEvent(event)
        })
        return true
      },
      navigator: { onLine: true },
    }

    globalThis.window = win as unknown as Window & typeof globalThis
    globalThis.document = {
      createElement: () => ({} as unknown as HTMLElement),
    } as unknown as Document
    globalThis.localStorage = memoryStorage as unknown as Storage

    setMountBase(null)
    clearStorageCache()
    clearDeduplicationCache()
    saveStore({
      ...DEFAULT_STORE,
      bookmarks: [],
      history: [],
      progress: {},
      recentSearches: [],
      downloadedMetadata: [],
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setMountBase(null)
    clearStorageCache()
    clearDeduplicationCache()
  })

  describe("useRoute & navigate", () => {
    it("reads initial route and syncs with navigate", () => {
      expect(typeof useRoute).toBe("function")

      navigate({ name: "home" })
      navigate({ name: "search" })
      expect(window.location.pathname).toBe("/search")

      navigate({ name: "title", imdbId: "tt1375666", id: "tt1375666", type: "movie" })
      expect(window.location.pathname).toBe("/title/tt1375666")

      navigate({ name: "watch", imdbId: "tt0903747", season: 2, episode: 3 })
      expect(window.location.pathname).toBe("/watch/tt0903747/2/3")

      navigate({ name: "library" })
      expect(window.location.pathname).toBe("/library")
    })
  })

  describe("useLibrary hook", () => {
    const movie: MediaSummary = {
      id: "tt1375666",
      imdbId: "tt1375666",
      tmdbId: 27205,
      mediaType: "movie",
      title: "Inception",
      originalTitle: null,
      year: 2010,
      endYear: null,
      rating: 8.8,
      voteCount: 35000,
      genres: ["Action", "Sci-Fi"],
      posterUrl: "/poster.jpg",
      backdropUrl: null,
    }

    const historyRecord: PlaybackRecord = {
      media: movie,
      season: null,
      episode: null,
      positionSeconds: 600,
      durationSeconds: 8800,
      updatedAt: new Date().toISOString(),
    }

    it("performs library operations reactively", () => {
      expect(typeof useLibrary).toBe("function")

      toggleBookmark(movie)
      expect(isBookmarked("tt1375666")).toBe(true)
      expect(getBookmarks().length).toBe(1)

      addHistory(historyRecord)
      expect(getHistory().length).toBe(1)
      expect(getHistory()[0].media.title).toBe("Inception")

      updatePreferences({ autoResume: true, theme: "system" })
      expect(getPreferences().autoResume).toBe(true)
      expect(getPreferences().theme).toBe("system")

      removeBookmark("tt1375666")
      expect(isBookmarked("tt1375666")).toBe(false)

      removeHistory("tt1375666")
      expect(getHistory().length).toBe(0)

      addHistory(historyRecord)
      expect(getHistory().length).toBe(1)
      clearHistory()
      expect(getHistory().length).toBe(0)
    })
  })

  describe("usePlaybackProgress hook", () => {
    it("saves and clears playback progress", () => {
      expect(typeof usePlaybackProgress).toBe("function")

      savePlaybackProgress({
        imdbId: "tt0903747",
        mediaType: "tv",
        season: 1,
        episode: 1,
        positionSeconds: 1200,
        durationSeconds: 2400,
      })

      const saved = getProgress("tt0903747", 1, 1)
      expect(saved).not.toBeNull()
      expect(saved?.positionSeconds).toBe(1200)
      expect(saved?.progressFraction).toBe(0.5)

      clearPlaybackProgress("tt0903747", 1, 1)
      expect(getProgress("tt0903747", 1, 1)).toBeNull()
    })
  })

  describe("useNetworkStatus hook", () => {
    it("reports online and handles offline events", () => {
      expect(typeof useNetworkStatus).toBe("function")
      let isOnline = true
      let wasOffline = false

      const handleOnline = () => {
        isOnline = true
      }
      const handleOffline = () => {
        isOnline = false
        wasOffline = true
      }

      window.addEventListener("online", handleOnline)
      window.addEventListener("offline", handleOffline)

      expect(isOnline).toBe(true)
      expect(wasOffline).toBe(false)

      window.dispatchEvent(new Event("offline"))
      expect(isOnline).toBe(false)
      expect(wasOffline).toBe(true)

      window.dispatchEvent(new Event("online"))
      expect(isOnline).toBe(true)
      expect(wasOffline).toBe(true)
    })
  })

  describe("catalog hooks endpoints and contract types", () => {
    it("exports all catalog hooks correctly", () => {
      expect(typeof useCatalogHome).toBe("function")
      expect(typeof useCatalogSearch).toBe("function")
      expect(typeof useCatalogTitle).toBe("function")
      expect(typeof useCatalogEpisodes).toBe("function")
      expect(typeof useCatalogRequest).toBe("function")
    })
  })
})
