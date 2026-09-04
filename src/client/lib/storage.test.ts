import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  addHistory,
  clearHistory,
  clearPlaybackProgress,
  clearRecentSearches,
  clearStorageCache,
  clearSyncableState,
  clearSyncMetadata,
  DEFAULT_PREFERENCES,
  DEFAULT_STORE,
  extractSyncableState,
  getBookmarks,
  getDownloadedMetadata,
  getHistory,
  getPreferences,
  getProgress,
  getStorageSnapshot,
  getSyncMetadata,
  historyRecordKey,
  isBookmarked,
  LEGACY_SEARCHES_KEY,
  LEGACY_SESSION_KEY,
  loadRecentSearches,
  loadStore,
  MAX_BOOKMARKS,
  MAX_HISTORY,
  MAX_PROGRESS,
  MAX_RECENT_SEARCHES,
  migrateFromLegacy,
  removeBookmark,
  removeDownloadedMetadata,
  removeHistory,
  replaceSyncableState,
  saveDownloadedMetadata,
  savePlaybackProgress,
  saveRecentSearch,
  saveStore,
  saveSyncMetadata,
  STORE_KEY,
  toggleBookmark,
  updatePreferences,
  type DownloadedMetaRecord,
  type MediaBookmark,
} from "./storage"
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

describe("versioned bounded storage & migration", () => {
  let memoryStorage: MemoryStorage

  beforeEach(() => {
    memoryStorage = new MemoryStorage()
    // Setup global window and localStorage
    const win = {
      localStorage: memoryStorage,
      location: { pathname: "/" },
      history: { pushState: () => {}, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    globalThis.window = win as unknown as Window & typeof globalThis
    globalThis.localStorage = memoryStorage as unknown as Storage
    clearStorageCache()
    saveStore({ ...DEFAULT_STORE, bookmarks: [], history: [], progress: {}, recentSearches: [], downloadedMetadata: [] })
  })

  afterEach(() => {
    memoryStorage.clear()
    clearStorageCache()
  })

  describe("storage validation", () => {
    it("returns default store when storage is empty or invalid JSON", () => {
      memoryStorage.setItem(STORE_KEY, "invalid-json{{}")
      const store = loadStore()
      expect(store.version).toBe(3)
      expect(store.bookmarks).toEqual([])
      expect(store.history).toEqual([])
    })

    it("filters out corrupted objects within arrays", () => {
      const corruptPayload = {
        version: 3,
        bookmarks: [
          { imdbId: "tt1", title: "Valid Title", mediaType: "movie" },
          { invalid: "no title or id" },
          null,
          "random string",
        ],
        history: [
          {
            media: { id: "tt1", title: "Movie 1", mediaType: "movie" },
            season: null,
            episode: null,
            positionSeconds: 10,
            durationSeconds: 100,
          },
          { media: null },
          { corrupted: true },
        ],
        progress: {
          valid: {
            id: "tt1",
            imdbId: "tt1",
            mediaType: "movie",
            positionSeconds: 10,
            durationSeconds: 100,
          },
          invalid: { notAValidProgress: true },
        },
        recentSearches: ["valid", "", 123, null],
      }
      memoryStorage.setItem(STORE_KEY, JSON.stringify(corruptPayload))
      const store = loadStore()

      expect(store.bookmarks.length).toBe(1)
      expect(store.bookmarks[0].imdbId).toBe("tt1")
      expect(store.history.length).toBe(1)
      expect(store.history[0].media.id).toBe("tt1")
      expect(store.progress["valid"]).toBeDefined()
      expect(store.progress["invalid"]).toBeUndefined()
      expect(store.recentSearches).toEqual(["valid"])
    })
  })

  describe("migration from legacy Hawk storage", () => {
    it("migrates recent searches from hawk.searches.v1", () => {
      memoryStorage.setItem(
        LEGACY_SEARCHES_KEY,
        JSON.stringify(["Inception", "Breaking Bad", "The Matrix"])
      )
      const migrated = migrateFromLegacy()
      expect(migrated.recentSearches).toEqual(["Inception", "Breaking Bad", "The Matrix"])
    })

    it("migrates legacy session titles into bookmarks and active torrent into history", () => {
      const legacySession = {
        mood: "thrilling",
        type: "movie",
        time: "standard",
        titles: [
          { id: "tt1375666", title: "Inception", mediaType: "movie", year: "2010" },
          { id: "tt0133093", title: "The Matrix", mediaType: "movie", year: "1999" },
        ],
        torrent: {
          infoHash: "abc12345",
          name: "Interstellar 2014",
          origin: { type: "movie", id: "tt0816692" },
        },
      }
      memoryStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify(legacySession))

      const migrated = migrateFromLegacy()
      expect(migrated.bookmarks.length).toBe(2)
      expect(migrated.bookmarks[0].imdbId).toBe("tt1375666")
      expect(migrated.bookmarks[0].title).toBe("Inception")
      expect(migrated.bookmarks[1].imdbId).toBe("tt0133093")

      expect(migrated.history.length).toBe(1)
      expect(migrated.history[0].media.id).toBe("tt0816692")
      expect(migrated.history[0].media.title).toBe("Interstellar 2014")
    })

    it("automatically migrates on loadStore when hawk.store.v3 is missing", () => {
      memoryStorage.removeItem(STORE_KEY)
      clearStorageCache()
      memoryStorage.setItem(LEGACY_SEARCHES_KEY, JSON.stringify(["Lord of the Rings"]))
      const loaded = loadStore()
      expect(loaded.recentSearches).toEqual(["Lord of the Rings"])
      // Confirm it persisted to the new key
      expect(memoryStorage.getItem(STORE_KEY)).not.toBeNull()
    })
  })

  describe("bounded history", () => {
    const makeRecord = (id: string, title: string, season: number | null = null, episode: number | null = null): PlaybackRecord => ({
      media: {
        id,
        imdbId: id,
        tmdbId: null,
        mediaType: season !== null ? "tv" : "movie",
        title,
        originalTitle: null,
        year: 2020,
        endYear: null,
        rating: 8.5,
        voteCount: 100,
        genres: ["Drama"],
        posterUrl: null,
        backdropUrl: null,
      },
      season,
      episode,
      positionSeconds: 120,
      durationSeconds: 3600,
      updatedAt: new Date().toISOString(),
    })

    it("adds history records and moves updated ones to front (MRU)", () => {
      addHistory(makeRecord("tt1", "Movie One"))
      addHistory(makeRecord("tt2", "Movie Two"))
      expect(getHistory().map((h) => h.media.id)).toEqual(["tt2", "tt1"])

      // Updating tt1 moves it back to the top
      addHistory(makeRecord("tt1", "Movie One Updated"))
      expect(getHistory().map((h) => h.media.id)).toEqual(["tt1", "tt2"])
      expect(getHistory()[0].media.title).toBe("Movie One Updated")
    })

    it("distinguishes tv episodes in history keys", () => {
      addHistory(makeRecord("tt0903747", "Breaking Bad", 1, 1))
      addHistory(makeRecord("tt0903747", "Breaking Bad", 1, 2))
      expect(getHistory().length).toBe(2)
      expect(historyRecordKey(getHistory()[0])).toBe("tt0903747:s1:e2")
      expect(historyRecordKey(getHistory()[1])).toBe("tt0903747:s1:e1")

      // Updating episode 1 moves it to front
      addHistory(makeRecord("tt0903747", "Breaking Bad", 1, 1))
      expect(historyRecordKey(getHistory()[0])).toBe("tt0903747:s1:e1")
      expect(getHistory().length).toBe(2)
    })

    it("bounds history to MAX_HISTORY (100) items", () => {
      for (let i = 0; i < MAX_HISTORY + 15; i++) {
        addHistory(makeRecord(`tt-id-${i}`, `Title ${i}`))
      }
      const history = getHistory()
      expect(history.length).toBe(MAX_HISTORY)
      // Most recent should be at the front
      expect(history[0].media.id).toBe(`tt-id-${MAX_HISTORY + 14}`)
      // Oldest ones beyond MAX_HISTORY should have been dropped
      expect(history.some((h) => h.media.id === "tt-id-0")).toBe(false)
    })

    it("removes single item and clears history", () => {
      addHistory(makeRecord("tt1", "Movie 1"))
      addHistory(makeRecord("tt2", "Movie 2"))
      removeHistory("tt1")
      expect(getHistory().map((h) => h.media.id)).toEqual(["tt2"])

      clearHistory()
      expect(getHistory()).toEqual([])
    })
  })

  describe("bounded bookmarks", () => {
    const makeSummary = (id: string, title: string): MediaSummary => ({
      id,
      imdbId: id,
      tmdbId: 10,
      mediaType: "movie",
      title,
      originalTitle: null,
      year: 2022,
      endYear: null,
      rating: 8.0,
      voteCount: 50,
      genres: ["Action"],
      posterUrl: null,
      backdropUrl: null,
    })

    it("toggles and checks bookmarks", () => {
      const movie = makeSummary("tt1375666", "Inception")
      expect(isBookmarked("tt1375666")).toBe(false)

      const added = toggleBookmark(movie)
      expect(added).toBe(true)
      expect(isBookmarked("tt1375666")).toBe(true)
      expect(getBookmarks().length).toBe(1)

      const removed = toggleBookmark(movie)
      expect(removed).toBe(false)
      expect(isBookmarked("tt1375666")).toBe(false)
      expect(getBookmarks().length).toBe(0)
    })

    it("bounds bookmarks to MAX_BOOKMARKS", () => {
      const bookmarks: MediaBookmark[] = []
      for (let i = 0; i < MAX_BOOKMARKS + 10; i++) {
        bookmarks.push({
          imdbId: `tt-${i}`,
          mediaType: "movie",
          title: `Movie ${i}`,
          year: 2020,
          rating: 7,
          posterUrl: null,
          backdropUrl: null,
          genres: [],
          bookmarkedAt: new Date().toISOString(),
        })
      }
      saveStore({ ...getStorageSnapshot(), bookmarks })
      expect(getBookmarks().length).toBe(MAX_BOOKMARKS)
    })

    it("removes bookmark directly", () => {
      toggleBookmark(makeSummary("tt1", "M1"))
      toggleBookmark(makeSummary("tt2", "M2"))
      removeBookmark("tt1")
      expect(isBookmarked("tt1")).toBe(false)
      expect(isBookmarked("tt2")).toBe(true)
    })
  })

  describe("bounded playback progress", () => {
    it("saves and clears playback progress", () => {
      savePlaybackProgress({
        imdbId: "tt1375666",
        mediaType: "movie",
        positionSeconds: 1500,
        durationSeconds: 3000,
      })

      const prog = getProgress("tt1375666")
      expect(prog).not.toBeNull()
      expect(prog?.positionSeconds).toBe(1500)
      expect(prog?.progressFraction).toBe(0.5)
      expect(prog?.completed).toBe(false)

      clearPlaybackProgress("tt1375666")
      expect(getProgress("tt1375666")).toBeNull()
    })

    it("marks completed when position is >= 90%", () => {
      savePlaybackProgress({
        imdbId: "tt1375666",
        mediaType: "movie",
        positionSeconds: 950,
        durationSeconds: 1000,
      })
      expect(getProgress("tt1375666")?.completed).toBe(true)
    })

    it("bounds progress entries to MAX_PROGRESS (200)", () => {
      for (let i = 0; i < MAX_PROGRESS + 10; i++) {
        savePlaybackProgress({
          imdbId: `tt-prog-${i}`,
          mediaType: "movie",
          positionSeconds: 100,
          durationSeconds: 200,
        })
      }
      const store = getStorageSnapshot()
      expect(Object.keys(store.progress).length).toBe(MAX_PROGRESS)
    })
  })

  describe("bounded recent searches", () => {
    it("deduplicates case-insensitively and puts recent on top", () => {
      saveRecentSearch("avatar")
      saveRecentSearch("batman")
      saveRecentSearch("Avatar")

      const searches = loadRecentSearches()
      expect(searches).toEqual(["Avatar", "batman"])
    })

    it("bounds recent searches to MAX_RECENT_SEARCHES (10)", () => {
      for (let i = 0; i < MAX_RECENT_SEARCHES + 5; i++) {
        saveRecentSearch(`Query ${i}`)
      }
      const searches = loadRecentSearches()
      expect(searches.length).toBe(MAX_RECENT_SEARCHES)
      expect(searches[0]).toBe(`Query ${MAX_RECENT_SEARCHES + 4}`)
    })

    it("clears recent searches", () => {
      saveRecentSearch("matrix")
      clearRecentSearches()
      expect(loadRecentSearches()).toEqual([])
    })
  })

  describe("preferences and downloaded metadata", () => {
    it("updates preferences partially and merges with defaults", () => {
      updatePreferences({ autoResume: false, defaultQuality: "2160p" })
      const prefs = getPreferences()
      expect(prefs.autoResume).toBe(false)
      expect(prefs.defaultQuality).toBe("2160p")
      expect(prefs.theme).toBe("dark") // default retained
    })

    it("saves, bounds, and removes downloaded metadata", () => {
      const meta: DownloadedMetaRecord = {
        id: "dl-1",
        imdbId: "tt1",
        mediaType: "movie",
        title: "Downloaded Title",
        season: null,
        episode: null,
        sizeBytes: 1500000000,
        downloadedAt: new Date().toISOString(),
        completed: true,
        posterUrl: null,
      }
      saveDownloadedMetadata(meta)
      expect(getDownloadedMetadata().length).toBe(1)
      expect(getDownloadedMetadata()[0].id).toBe("dl-1")

      removeDownloadedMetadata("dl-1")
      expect(getDownloadedMetadata().length).toBe(0)
    })
  })

  describe("syncable state and sync metadata", () => {
    it("ensures DEFAULT_PREFERENCES and DEFAULT_STORE are immutable-safe", () => {
      expect(Object.isFrozen(DEFAULT_PREFERENCES)).toBe(true)
      expect(Object.isFrozen(DEFAULT_STORE)).toBe(true)
      expect(DEFAULT_PREFERENCES.autoplay).toBe(true)
      expect(() => {
        // @ts-expect-error mutating frozen object
        DEFAULT_PREFERENCES.autoplay = false
      }).toThrow()
    })

    it("extracts and replaces only syncable fields while preserving searches and downloads", () => {
      saveRecentSearch("matrix")
      const dlMeta: DownloadedMetaRecord = {
        id: "dl-local",
        imdbId: "tt0133093",
        mediaType: "movie",
        title: "The Matrix",
        season: null,
        episode: null,
        sizeBytes: 2000000000,
        downloadedAt: "2026-09-01T00:00:00.000Z",
        completed: true,
        posterUrl: null,
      }
      saveDownloadedMetadata(dlMeta)

      const extracted = extractSyncableState()
      expect(extracted.bookmarks).toEqual([])
      expect(extracted.history).toEqual([])
      expect(extracted.progress).toEqual({})
      expect(extracted.preferences.autoplay).toBe(true)

      const newSyncState = {
        bookmarks: [
          {
            imdbId: "tt0133093",
            title: "The Matrix",
            mediaType: "movie" as const,
            year: 1999,
            rating: 8.7,
            posterUrl: null,
            backdropUrl: null,
            genres: ["Action", "Sci-Fi"],
            bookmarkedAt: "2026-09-02T00:00:00.000Z",
          },
        ],
        history: [],
        progress: {
          tt0133093: {
            id: "tt0133093",
            imdbId: "tt0133093",
            mediaType: "movie" as const,
            season: null,
            episode: null,
            positionSeconds: 500,
            durationSeconds: 8000,
            progressFraction: 0.0625,
            completed: false,
            updatedAt: "2026-09-02T00:00:00.000Z",
          },
        },
        preferences: {
          ...DEFAULT_PREFERENCES,
          theme: "light" as const,
        },
      }

      replaceSyncableState(newSyncState)

      expect(getBookmarks().length).toBe(1)
      expect(getBookmarks()[0].imdbId).toBe("tt0133093")
      expect(getProgress("tt0133093")?.positionSeconds).toBe(500)
      expect(getPreferences().theme).toBe("light")

      // Device-local searches and downloads are preserved!
      expect(loadRecentSearches()).toEqual(["matrix"])
      expect(getDownloadedMetadata().length).toBe(1)
      expect(getDownloadedMetadata()[0].id).toBe("dl-local")
    })

    it("clears syncable state on logout while preserving local downloads and searches", () => {
      saveRecentSearch("interstellar")
      const dlMeta: DownloadedMetaRecord = {
        id: "dl-local-2",
        imdbId: "tt0816692",
        mediaType: "movie",
        title: "Interstellar",
        season: null,
        episode: null,
        sizeBytes: 3000000000,
        downloadedAt: "2026-09-01T00:00:00.000Z",
        completed: true,
        posterUrl: null,
      }
      saveDownloadedMetadata(dlMeta)

      const interstellar: MediaSummary = {
        id: "tt0816692",
        imdbId: "tt0816692",
        tmdbId: 157336,
        title: "Interstellar",
        originalTitle: "Interstellar",
        mediaType: "movie",
        year: 2014,
        endYear: null,
        rating: 8.7,
        voteCount: 2000000,
        posterUrl: null,
        backdropUrl: null,
        genres: [],
      }
      toggleBookmark(interstellar)
      expect(getBookmarks().length).toBe(1)

      clearSyncableState({ preservePreferences: true })

      expect(getBookmarks().length).toBe(0)
      expect(getHistory().length).toBe(0)
      expect(Object.keys(getStorageSnapshot().progress).length).toBe(0)
      expect(loadRecentSearches()).toEqual(["interstellar"])
      expect(getDownloadedMetadata().length).toBe(1)
    })

    it("persists, retrieves, and clears sync metadata", () => {
      expect(getSyncMetadata()).toBeNull()

      const meta = {
        userId: "user-123",
        serverRevision: 4,
        baseState: {
          bookmarks: [],
          history: [],
          progress: {},
          preferences: { ...DEFAULT_PREFERENCES },
        },
      }

      saveSyncMetadata(meta)
      const retrieved = getSyncMetadata()
      expect(retrieved).not.toBeNull()
      expect(retrieved?.userId).toBe("user-123")
      expect(retrieved?.serverRevision).toBe(4)

      clearSyncMetadata()
      expect(getSyncMetadata()).toBeNull()
    })
  })
})
