import { describe, expect, it } from "bun:test"
import {
  mergeBookmarks,
  mergeHistory,
  mergePreferences,
  mergeProgress,
  threeWayMerge,
} from "./sync-merge"
import { DEFAULT_PREFERENCES, type MediaBookmark } from "./storage"
import type { PlaybackRecord } from "../../shared/playback"

describe("sync-merge", () => {
  describe("mergeBookmarks", () => {
    const bm1: MediaBookmark = {
      imdbId: "tt001",
      title: "Movie One",
      mediaType: "movie",
      year: 2020,
      rating: 7.5,
      posterUrl: null,
      backdropUrl: null,
      genres: ["Action"],
      bookmarkedAt: "2026-09-01T10:00:00.000Z",
    }
    const bm2: MediaBookmark = {
      imdbId: "tt002",
      title: "Movie Two",
      mediaType: "movie",
      year: 2021,
      rating: 8.0,
      posterUrl: null,
      backdropUrl: null,
      genres: ["Drama"],
      bookmarkedAt: "2026-09-01T11:00:00.000Z",
    }

    it("keeps base when neither local nor remote changed", () => {
      const merged = mergeBookmarks([bm1], [bm1], [bm1])
      expect(merged.length).toBe(1)
      expect(merged[0].imdbId).toBe("tt001")
    })

    it("accepts local addition when remote is unchanged", () => {
      const merged = mergeBookmarks([bm1], [bm1, bm2], [bm1])
      expect(merged.length).toBe(2)
      expect(merged.map((b) => b.imdbId).sort()).toEqual(["tt001", "tt002"])
    })

    it("accepts remote addition when local is unchanged", () => {
      const merged = mergeBookmarks([bm1], [bm1], [bm1, bm2])
      expect(merged.length).toBe(2)
      expect(merged.map((b) => b.imdbId).sort()).toEqual(["tt001", "tt002"])
    })

    it("accepts local deletion when remote is unchanged", () => {
      const merged = mergeBookmarks([bm1, bm2], [bm1], [bm1, bm2])
      expect(merged.length).toBe(1)
      expect(merged[0].imdbId).toBe("tt001")
    })

    it("accepts remote deletion when local is unchanged", () => {
      const merged = mergeBookmarks([bm1, bm2], [bm1, bm2], [bm2])
      expect(merged.length).toBe(1)
      expect(merged[0].imdbId).toBe("tt002")
    })

    it("resolves conflicting additions/edits by preferring later ISO timestamp (bookmarkedAt)", () => {
      const bmLocal: MediaBookmark = {
        ...bm1,
        title: "Movie One Local",
        bookmarkedAt: "2026-09-02T12:00:00.000Z",
      }
      const bmRemote: MediaBookmark = {
        ...bm1,
        title: "Movie One Remote",
        bookmarkedAt: "2026-09-03T12:00:00.000Z",
      }
      const merged = mergeBookmarks([bm1], [bmLocal], [bmRemote])
      expect(merged.length).toBe(1)
      expect(merged[0].title).toBe("Movie One Remote")
    })

    it("resolves both deleted as deleted", () => {
      const merged = mergeBookmarks([bm1], [], [])
      expect(merged.length).toBe(0)
    })
  })

  describe("mergeHistory & mergeProgress", () => {
    const h1: PlaybackRecord = {
      media: {
        id: "tt100",
        imdbId: "tt100",
        tmdbId: null,
        title: "Film A",
        originalTitle: "Film A",
        mediaType: "movie",
        year: 2024,
        endYear: null,
        rating: 7.0,
        voteCount: 50,
        posterUrl: null,
        backdropUrl: null,
        genres: [],
      },
      season: null,
      episode: null,
      positionSeconds: 100,
      durationSeconds: 1000,
      updatedAt: "2026-09-01T10:00:00.000Z",
    }

    it("prefers later updatedAt when both sides modified history item", () => {
      const hLocal: PlaybackRecord = {
        ...h1,
        positionSeconds: 500,
        updatedAt: "2026-09-02T10:00:00.000Z",
      }
      const hRemote: PlaybackRecord = {
        ...h1,
        positionSeconds: 800,
        updatedAt: "2026-09-03T10:00:00.000Z", // later
      }

      const merged = mergeHistory([h1], [hLocal], [hRemote])
      expect(merged.length).toBe(1)
      expect(merged[0].positionSeconds).toBe(800)
    })

    it("merges progress map preserving deletions and preferring later updatedAt on conflict", () => {
      const baseProg = {
        "p1": {
          id: "p1",
          imdbId: "tt100",
          mediaType: "movie" as const,
          season: null,
          episode: null,
          positionSeconds: 100,
          durationSeconds: 1000,
          progressFraction: 0.1,
          completed: false,
          updatedAt: "2026-09-01T10:00:00.000Z",
        },
      }
      const localProg = {
        "p1": {
          ...baseProg.p1,
          positionSeconds: 900,
          progressFraction: 0.9,
          updatedAt: "2026-09-03T10:00:00.000Z", // later than remote
        },
      }
      const remoteProg = {
        "p1": {
          ...baseProg.p1,
          positionSeconds: 400,
          progressFraction: 0.4,
          updatedAt: "2026-09-02T10:00:00.000Z",
        },
      }

      const merged = mergeProgress(baseProg, localProg, remoteProg)
      expect(merged.p1.positionSeconds).toBe(900)
    })
  })

  describe("mergePreferences", () => {
    it("prefers local changes only when dirty against base; otherwise remote wins", () => {
      const base = { ...DEFAULT_PREFERENCES, theme: "dark" as const, defaultQuality: "1080p" as const }
      const local = { ...base, theme: "light" as const } // dirty theme
      const remote = { ...base, defaultQuality: "2160p" as const } // remote changed quality

      const merged = mergePreferences(base, local, remote)
      expect(merged.theme).toBe("light")
      expect(merged.defaultQuality).toBe("2160p")
    })
  })

  describe("threeWayMerge full state", () => {
    it("executes three-way merge across all syncable domains", () => {
      const base = {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      }
      const local = {
        ...base,
        preferences: { ...base.preferences, theme: "light" as const },
      }
      const remote = {
        ...base,
        bookmarks: [
          {
            imdbId: "tt999",
            title: "Remote Movie",
            mediaType: "movie" as const,
            year: 2022,
            rating: 8.5,
            posterUrl: null,
            backdropUrl: null,
            genres: [],
            bookmarkedAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      }

      const merged = threeWayMerge(base, local, remote)
      expect(merged.preferences.theme).toBe("light")
      expect(merged.bookmarks.length).toBe(1)
      expect(merged.bookmarks[0].imdbId).toBe("tt999")
    })

    it("sorts bookmarks by bookmarkedAt descending so newest additions survive MAX_BOOKMARKS truncation", () => {
      // Create 200 base bookmarks with older timestamps
      const baseBookmarks: MediaBookmark[] = []
      for (let i = 0; i < 200; i++) {
        baseBookmarks.push({
          imdbId: `tt-base-${String(i).padStart(3, "0")}`,
          title: `Old Base Movie ${i}`,
          mediaType: "movie",
          year: 2020,
          rating: 7.0,
          posterUrl: null,
          backdropUrl: null,
          genres: [],
          bookmarkedAt: new Date(Date.UTC(2025, 0, 1, 0, i, 0)).toISOString(),
        })
      }

      // Local has 5 brand new bookmarks with recent 2026 timestamps
      const newLocalBookmarks: MediaBookmark[] = []
      for (let i = 0; i < 5; i++) {
        newLocalBookmarks.push({
          imdbId: `tt-new-${i}`,
          title: `Brand New Movie ${i}`,
          mediaType: "movie",
          year: 2026,
          rating: 9.0,
          posterUrl: null,
          backdropUrl: null,
          genres: [],
          bookmarkedAt: new Date(Date.UTC(2026, 8, 1, 12, i, 0)).toISOString(),
        })
      }

      const base = {
        bookmarks: baseBookmarks,
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      }
      const local = {
        ...base,
        bookmarks: [...newLocalBookmarks, ...baseBookmarks],
      }
      const remote = {
        ...base,
      }

      const merged = threeWayMerge(base, local, remote)

      // Bounded to MAX_BOOKMARKS = 200
      expect(merged.bookmarks.length).toBe(200)

      // All 5 brand new bookmarks must survive truncation and appear at the front
      for (let i = 0; i < 5; i++) {
        const found = merged.bookmarks.some((b) => b.imdbId === `tt-new-${i}`)
        expect(found).toBe(true)
      }
      expect(merged.bookmarks[0].imdbId).toBe("tt-new-4")
      expect(merged.bookmarks[4].imdbId).toBe("tt-new-0")

      // The 5 oldest base bookmarks (tt-base-000 to tt-base-004) must have been evicted
      for (let i = 0; i < 5; i++) {
        const evicted = merged.bookmarks.some((b) => b.imdbId === `tt-base-${String(i).padStart(3, "0")}`)
        expect(evicted).toBe(false)
      }
    })

    it("sorts history by updatedAt descending so newest additions survive MAX_HISTORY truncation", () => {
      // Create 100 base history records with older timestamps
      const baseHistory: PlaybackRecord[] = []
      for (let i = 0; i < 100; i++) {
        baseHistory.push({
          media: {
            id: `tt-hist-${String(i).padStart(3, "0")}`,
            imdbId: `tt-hist-${String(i).padStart(3, "0")}`,
            tmdbId: null,
            title: `Old History ${i}`,
            originalTitle: `Old History ${i}`,
            mediaType: "movie",
            year: 2023,
            endYear: null,
            rating: 7.0,
            voteCount: 10,
            posterUrl: null,
            backdropUrl: null,
            genres: [],
          },
          season: null,
          episode: null,
          positionSeconds: 100,
          durationSeconds: 1000,
          updatedAt: new Date(Date.UTC(2025, 0, 1, 0, i, 0)).toISOString(),
        })
      }

      // Local has 5 brand new history records with recent 2026 timestamps
      const newHistory: PlaybackRecord[] = []
      for (let i = 0; i < 5; i++) {
        newHistory.push({
          media: {
            id: `tt-newhist-${i}`,
            imdbId: `tt-newhist-${i}`,
            tmdbId: null,
            title: `New History ${i}`,
            originalTitle: `New History ${i}`,
            mediaType: "movie",
            year: 2026,
            endYear: null,
            rating: 8.5,
            voteCount: 20,
            posterUrl: null,
            backdropUrl: null,
            genres: [],
          },
          season: null,
          episode: null,
          positionSeconds: 500,
          durationSeconds: 1200,
          updatedAt: new Date(Date.UTC(2026, 8, 2, 10, i, 0)).toISOString(),
        })
      }

      const base = {
        bookmarks: [],
        history: baseHistory,
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      }
      const local = {
        ...base,
        history: [...newHistory, ...baseHistory],
      }
      const remote = {
        ...base,
      }

      const merged = threeWayMerge(base, local, remote)

      // Bounded to MAX_HISTORY = 100
      expect(merged.history.length).toBe(100)

      // All 5 brand new history items must survive truncation and appear at the front
      for (let i = 0; i < 5; i++) {
        const found = merged.history.some((h) => h.media.imdbId === `tt-newhist-${i}`)
        expect(found).toBe(true)
      }
      expect(merged.history[0].media.imdbId).toBe("tt-newhist-4")
      expect(merged.history[4].media.imdbId).toBe("tt-newhist-0")

      // The 5 oldest base history records (tt-hist-000 to tt-hist-004) must have been evicted
      for (let i = 0; i < 5; i++) {
        const evicted = merged.history.some((h) => h.media.imdbId === `tt-hist-${String(i).padStart(3, "0")}`)
        expect(evicted).toBe(false)
      }
    })
  })
})
