import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  getAuthSnapshot,
  getDeviceName,
  initAuth,
  login,
  logout,
  resetAuthState,
  revokeSession,
  subscribeAuth,
  updateProfileVisibility,
} from "./auth"
import {
  clearStorageCache,
  DEFAULT_PREFERENCES,
  getBookmarks,
  getDownloadedMetadata,
  getPreferences,
  getSyncMetadata,
  loadRecentSearches,
  saveDownloadedMetadata,
  saveRecentSearch,
  saveSyncMetadata,
  toggleBookmark,
  type DownloadedMetaRecord,
} from "./storage"
import type { MediaSummary } from "../../shared/media"

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

describe("auth store and actions", () => {
  const originalFetch = globalThis.fetch
  let memoryStorage: MemoryStorage

  beforeEach(() => {
    memoryStorage = new MemoryStorage()
    const win = {
      localStorage: memoryStorage,
      location: { pathname: "/" },
      addEventListener: () => {},
      removeEventListener: () => {},
    }
    globalThis.window = win as unknown as Window & typeof globalThis
    globalThis.localStorage = memoryStorage as unknown as Storage

    resetAuthState()
    clearStorageCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    memoryStorage.clear()
    resetAuthState()
    clearStorageCache()
  })

  describe("signed-out startup and error handling", () => {
    it("handles 401 from /me as a normal signed-out state without error", async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/auth/me")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("{}", { status: 200 })
      }

      await initAuth()

      const snap = getAuthSnapshot()
      expect(snap.isInitialized).toBe(true)
      expect(snap.status).toBe("unauthenticated")
      expect(snap.user).toBeNull()
      expect(snap.session).toBeNull()
      expect(snap.error).toBeNull()
    })

    it("handles 500 error from /me gracefully with error state", async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/auth/me")) {
          return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("{}", { status: 200 })
      }

      await initAuth()

      const snap = getAuthSnapshot()
      expect(snap.isInitialized).toBe(true)
      expect(snap.status).toBe("error")
      expect(snap.user).toBeNull()
      expect(snap.error).toBe("Internal server error")
    })
  })

  describe("device name helper", () => {
    it("derives a bounded non-fingerprinting label under 64 characters", () => {
      const name = getDeviceName()
      expect(typeof name).toBe("string")
      expect(name.length).toBeGreaterThan(0)
      expect(name.length).toBeLessThanOrEqual(64)
      expect(/[a-f0-9]{32,}/i.test(name)).toBe(false) // no hashes/uuids/fingerprints
    })
  })

  describe("login, register, and credential safety", () => {
    it("authenticates and never writes password or cookies into localStorage or state", async () => {
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              user: { id: "u-1", username: "bob", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s-1", deviceName: "Chrome on macOS", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Set-Cookie": "hawk_session=secret_token; HttpOnly",
              },
            }
          )
        }
        return new Response("{}", { status: 200 })
      }

      let notified = false
      const unsubscribe = subscribeAuth(() => {
        notified = true
      })

      const res = await login({ username: "bob", password: "SecretPassword99!" })
      expect(res.user.username).toBe("bob")
      expect(notified).toBe(true)

      const snap = getAuthSnapshot()
      expect(snap.status).toBe("authenticated")
      expect(snap.user?.username).toBe("bob")
      expect(snap.session?.id).toBe("s-1")
      expect(window.localStorage.getItem("hawk.auth_hint.v1")).toBe("1")

      // Verify no passwords or tokens leaked into localStorage
      if (typeof window !== "undefined" && window.localStorage) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i)!
          const value = window.localStorage.getItem(key)!
          expect(value).not.toContain("SecretPassword99!")
          expect(value).not.toContain("secret_token")
        }
      }

      unsubscribe()
    })
  })

  describe("logout and clearing private account state", () => {
    it("clears private bookmarks/history and sync metadata while preserving local searches and downloads", async () => {
      // Setup authenticated user
      globalThis.fetch = async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              user: { id: "u-1", username: "bob", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s-1", deviceName: "Web", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }
        if (url.includes("/api/auth/logout")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
        return new Response("{}", { status: 200 })
      }

      await login({ username: "bob", password: "password123" })

      // Populate sync metadata and user state
      saveSyncMetadata({
        userId: "u-1",
        serverRevision: 3,
        baseState: {
          bookmarks: [],
          history: [],
          progress: {},
          preferences: getPreferences(),
        },
      })
      const movieSummary: MediaSummary = {
        id: "tt01",
        imdbId: "tt01",
        tmdbId: null,
        title: "Secret Movie",
        originalTitle: "Secret Movie",
        mediaType: "movie",
        year: 2024,
        endYear: null,
        rating: 8.0,
        voteCount: 100,
        posterUrl: null,
        backdropUrl: null,
        genres: [],
      }
      toggleBookmark(movieSummary)
      saveRecentSearch("local search query")
      const dl: DownloadedMetaRecord = {
        id: "dl-offline",
        imdbId: "tt01",
        mediaType: "movie",
        title: "Secret Movie",
        season: null,
        episode: null,
        sizeBytes: 1000,
        downloadedAt: "2026-09-01T00:00:00Z",
        completed: true,
        posterUrl: null,
      }
      saveDownloadedMetadata(dl)

      expect(getBookmarks().length).toBe(1)
      expect(getSyncMetadata()).not.toBeNull()
      expect(loadRecentSearches()).toEqual(["local search query"])
      expect(getDownloadedMetadata().length).toBe(1)

      // Log out
      await logout()

      const snap = getAuthSnapshot()
      expect(snap.status).toBe("unauthenticated")
      expect(snap.user).toBeNull()
      expect(snap.session).toBeNull()
      expect(window.localStorage.getItem("hawk.auth_hint.v1")).toBeNull()

      // Sync metadata is cleared
      expect(getSyncMetadata()).toBeNull()

      // Private account state is cleared
      expect(getBookmarks().length).toBe(0)

      // Offline downloads and device-local searches remain intact!
      expect(loadRecentSearches()).toEqual(["local search query"])
      expect(getDownloadedMetadata().length).toBe(1)
      expect(getDownloadedMetadata()[0].id).toBe("dl-offline")
    })
  })

  describe("profile visibility and session revocation", () => {
    it("updates profile visibility in auth store", async () => {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              user: { id: "u-1", username: "bob", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s-1", deviceName: "Web", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }
        if (url.includes("/api/user/profile") && init?.method === "PATCH") {
          return new Response(
            JSON.stringify({ username: "bob", publicProfile: true }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }
        return new Response("{}", { status: 200 })
      }

      await login({ username: "bob", password: "password123" })
      expect(getAuthSnapshot().user?.publicProfile).toBe(false)

      const result = await updateProfileVisibility(true)
      expect(result).toBe(true)
      expect(getAuthSnapshot().user?.publicProfile).toBe(true)
    })

    it("revoking current session clears local auth state without running doomed sync flush or second logout call", async () => {
      const calls: string[] = []
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        const method = init?.method ?? "GET"
        calls.push(`${method} ${url}`)
        if (url.includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              user: { id: "u-1", username: "bob", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s-current", deviceName: "Web", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }
        if (url.includes("/api/auth/sessions/s-current") && method === "DELETE") {
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
        }
        return new Response("{}", { status: 200 })
      }

      await login({ username: "bob", password: "password123" })
      expect(getAuthSnapshot().status).toBe("authenticated")
      expect(getAuthSnapshot().session?.id).toBe("s-current")

      // Add a bookmark and sync metadata
      toggleBookmark({
        id: "tt-rev-1",
        imdbId: "tt-rev-1",
        tmdbId: null,
        title: "Session Revocation Test",
        originalTitle: "Session Revocation Test",
        mediaType: "movie",
        year: 2026,
        endYear: null,
        rating: 8.0,
        voteCount: 50,
        posterUrl: null,
        backdropUrl: null,
        genres: [],
      })
      saveSyncMetadata({
        userId: "u-1",
        serverRevision: 1,
        baseState: { bookmarks: [], history: [], progress: {}, preferences: { ...DEFAULT_PREFERENCES } },
      })
      expect(getBookmarks().length).toBe(1)
      expect(getSyncMetadata()).not.toBeNull()

      calls.length = 0
      const ok = await revokeSession("s-current")
      expect(ok).toBe(true)

      // Only the DELETE /api/auth/sessions/s-current should have been called; NO POST /api/auth/logout or sync flush
      expect(calls).toEqual(["DELETE /api/auth/sessions/s-current"])

      // Auth state reset
      const snap = getAuthSnapshot()
      expect(snap.status).toBe("unauthenticated")
      expect(snap.user).toBeNull()
      expect(snap.session).toBeNull()

      // Local private syncable state cleared
      expect(getBookmarks().length).toBe(0)
      expect(getSyncMetadata()).toBeNull()
    })
  })
})
