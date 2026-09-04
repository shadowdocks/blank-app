import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  flushSync,
  getSyncCoordinatorSnapshot,
  startSyncCoordinator,
  stopSyncCoordinator,
  syncAfterLogin,
  syncAfterRegister,
} from "./sync"
import {
  clearStorageCache,
  DEFAULT_PREFERENCES,
  getBookmarks,
  getDownloadedMetadata,
  getSyncMetadata,
  loadRecentSearches,
  replaceSyncableState,
  saveDownloadedMetadata,
  saveRecentSearch,
  saveSyncMetadata,
  toggleBookmark,
  type MediaBookmark,
} from "./storage"
import { getAuthSnapshot, resetAuthState } from "./auth"
import type { AccountSession, AccountUser, HawkSyncedState } from "./account-types"
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

function parseRequest(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (typeof input === "string") {
    return { url: input, method: (init?.method || "GET").toUpperCase() }
  }
  if (input instanceof URL) {
    return { url: input.toString(), method: (init?.method || "GET").toUpperCase() }
  }
  return { url: input.url, method: (input.method || init?.method || "GET").toUpperCase() }
}

function makeMovie(id: string, title: string): MediaSummary {
  return {
    id,
    imdbId: id,
    tmdbId: null,
    title,
    originalTitle: title,
    mediaType: "movie",
    year: 2024,
    endYear: null,
    rating: 8.0,
    voteCount: 100,
    posterUrl: null,
    backdropUrl: null,
    genres: [],
  }
}

describe("sync coordinator and lifecycle", () => {
  const originalFetch = globalThis.fetch
  let memoryStorage: MemoryStorage
  let eventListeners: Record<string, () => void> = {}

  const mockUser: AccountUser = {
    id: "user-abc",
    username: "charlie",
    createdAt: 1756684800000,
    publicProfile: false,
  }

  const mockSession: AccountSession = {
    id: "sess-abc",
    deviceName: "Test Browser",
    createdAt: 1756684800000,
    lastSeenAt: 1756684800000,
    isCurrent: true,
  }

  beforeEach(() => {
    eventListeners = {}
    memoryStorage = new MemoryStorage()
    const win = {
      localStorage: memoryStorage,
      location: { pathname: "/" },
      addEventListener: (type: string, listener: () => void) => {
        eventListeners[type] = listener
      },
      removeEventListener: (type: string) => {
        delete eventListeners[type]
      },
    }
    globalThis.window = win as unknown as Window & typeof globalThis
    globalThis.localStorage = memoryStorage as unknown as Storage

    const doc = {
      visibilityState: "visible",
      addEventListener: (type: string, listener: () => void) => {
        eventListeners[type] = listener
      },
      removeEventListener: (type: string) => {
        delete eventListeners[type]
      },
    }
    globalThis.document = doc as unknown as Document

    resetAuthState()
    clearStorageCache()
  })

  afterEach(() => {
    stopSyncCoordinator()
    globalThis.fetch = originalFetch
    memoryStorage.clear()
    resetAuthState()
    clearStorageCache()
  })

  it("uploads existing guest state at revision 0 on first registration", async () => {
    // Guest saved a bookmark before registration
    toggleBookmark(makeMovie("tt001", "Guest Movie"))
    expect(getBookmarks().length).toBe(1)

    let putPayload: { baseRevision: number; state: HawkSyncedState } | null = null

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && init?.method === "PUT") {
        putPayload = JSON.parse(String(init.body))
        return new Response(
          JSON.stringify({ revision: 1, state: putPayload!.state }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    // Authenticate user via auth state
    const { initAuth } = await import("./auth")
    await initAuth()

    await syncAfterRegister(mockUser)

    expect(putPayload).not.toBeNull()
    expect(putPayload!.baseRevision).toBe(0)
    expect(putPayload!.state.bookmarks.length).toBe(1)
    expect(putPayload!.state.bookmarks[0].imdbId).toBe("tt001")

    const meta = getSyncMetadata()
    expect(meta).not.toBeNull()
    expect(meta?.userId).toBe(mockUser.id)
    expect(meta?.serverRevision).toBe(1)
    expect(meta?.baseState.bookmarks.length).toBe(1)
  })

  it("imports anonymous guest state on login when account has no local sync metadata", async () => {
    // Guest saved a local bookmark
    toggleBookmark(makeMovie("ttLocal", "Local Guest Title"))

    // Remote account already has a different bookmark
    const remoteBookmark: MediaBookmark = {
      imdbId: "ttRemote",
      title: "Remote Cloud Title",
      mediaType: "movie",
      year: 2024,
      rating: 8.0,
      posterUrl: null,
      backdropUrl: null,
      genres: [],
      bookmarkedAt: "2026-09-01T00:00:00Z",
    }

    let putCount = 0
    let putRevision: number | null = null

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && init?.method === "PUT") {
        putCount++
        const body = JSON.parse(String(init.body))
        putRevision = body.baseRevision
        return new Response(
          JSON.stringify({ revision: 6, state: body.state }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.includes("/api/user/sync")) {
        return new Response(
          JSON.stringify({
            revision: 5,
            state: {
              bookmarks: [remoteBookmark],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    await syncAfterLogin(mockUser)

    expect(putCount).toBe(1)
    expect(putRevision).toBe(5)

    // Merged state has BOTH the remote cloud bookmark and local guest bookmark
    const finalBookmarks = getBookmarks()
    expect(finalBookmarks.length).toBe(2)
    const ids = finalBookmarks.map((b) => b.imdbId).sort()
    expect(ids).toEqual(["ttLocal", "ttRemote"])

    const meta = getSyncMetadata()
    expect(meta?.serverRevision).toBe(6)
  })

  it("handles 409 conflict, executes 3-way merge, and retries exactly once against serverRevision", async () => {
    // Set matching local sync metadata at revision 3
    const baseBookmark: MediaBookmark = {
      imdbId: "ttBase",
      title: "Base Film",
      mediaType: "movie",
      year: 2020,
      rating: 7.0,
      posterUrl: null,
      backdropUrl: null,
      genres: [],
      bookmarkedAt: "2026-09-01T00:00:00Z",
    }
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 3,
      baseState: {
        bookmarks: [baseBookmark],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })
    replaceSyncableState({
      bookmarks: [
        baseBookmark,
        {
          imdbId: "ttLocalAdded",
          title: "Local Added",
          mediaType: "movie",
          year: 2023,
          rating: 7.2,
          posterUrl: null,
          backdropUrl: null,
          genres: [],
          bookmarkedAt: "2026-09-02T00:00:00Z",
        },
      ],
      history: [],
      progress: {},
      preferences: { ...DEFAULT_PREFERENCES },
    })

    let putCount = 0
    const serverState: HawkSyncedState = {
      bookmarks: [
        baseBookmark,
        {
          imdbId: "ttRemoteAdded",
          title: "Remote Added",
          mediaType: "movie",
          year: 2024,
          rating: 8.8,
          posterUrl: null,
          backdropUrl: null,
          genres: [],
          bookmarkedAt: "2026-09-02T10:00:00Z",
        },
      ],
      history: [],
      progress: {},
      preferences: { ...DEFAULT_PREFERENCES },
    }

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && init?.method === "PUT") {
        putCount++
        const body = JSON.parse(String(init.body))
        if (putCount === 1) {
          // Return 409 conflict with advanced revision 5
          return new Response(
            JSON.stringify({
              error: "Conflict detected: server revision advanced",
              code: "CONFLICT",
              serverRevision: 5,
              serverState,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          )
        }
        // Second attempt: succeeds
        return new Response(
          JSON.stringify({ revision: 6, state: body.state }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    await flushSync()

    expect(putCount).toBe(2) // 1 initial + exactly 1 retry

    // Check merged result
    const currentBookmarks = getBookmarks()
    expect(currentBookmarks.length).toBe(3)
    const ids = currentBookmarks.map((b) => b.imdbId).sort()
    expect(ids).toEqual(["ttBase", "ttLocalAdded", "ttRemoteAdded"])

    const meta = getSyncMetadata()
    expect(meta?.serverRevision).toBe(6)
  })

  it("never loops conflicts if the second retry fails", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 3,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })
    toggleBookmark(makeMovie("ttDirty", "Dirty"))

    let putCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && init?.method === "PUT") {
        putCount++
        return new Response(
          JSON.stringify({
            error: "Persistent conflict",
            code: "CONFLICT",
            serverRevision: 4 + putCount,
            serverState: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    await flushSync()

    // Must NOT loop infinitely: exactly 2 calls (initial + 1 retry)
    expect(putCount).toBe(2)
    const snap = getSyncCoordinatorSnapshot()
    expect(snap.lastError).toContain("Persistent conflict")
  })

  it("coalesces concurrent sync calls into one execution and trailing batch", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let putCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && init?.method === "PUT") {
        putCount++
        await new Promise((r) => setTimeout(r, 20))
        return new Response(
          JSON.stringify({ revision: 2, state: JSON.parse(String(init.body)).state }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    toggleBookmark(makeMovie("ttSync1", "Sync 1"))

    // Fire multiple concurrent flushSync calls simultaneously
    await Promise.all([flushSync(), flushSync(), flushSync()])

    expect(putCount).toBe(1)
  })

  it("pulls remote changes when server revision increments and local is clean", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    const cloudBookmark: MediaBookmark = {
      imdbId: "ttCloud100",
      title: "Cloud Movie",
      mediaType: "movie",
      year: 2025,
      rating: 9.0,
      posterUrl: null,
      backdropUrl: null,
      genres: [],
      bookmarkedAt: "2026-09-01T00:00:00Z",
    }

    let getCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && method === "GET") {
        getCount++
        return new Response(
          JSON.stringify({
            revision: 2,
            state: {
              bookmarks: [cloudBookmark],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    await flushSync()

    expect(getCount).toBe(1)
    expect(getBookmarks().length).toBe(1)
    expect(getBookmarks()[0].imdbId).toBe("ttCloud100")
    const meta = getSyncMetadata()
    expect(meta?.serverRevision).toBe(2)
  })

  it("triggers sync on online and visibilitychange with 30-second cooldown", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let getCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync")) {
        getCount++
        return new Response(
          JSON.stringify({
            revision: 1,
            state: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    startSyncCoordinator()

    // Trigger online
    if (eventListeners["online"]) {
      eventListeners["online"]()
    }
    await new Promise((r) => setTimeout(r, 10))
    expect(getCount).toBe(1)

    // Trigger visibilitychange to visible (within cooldown: should NOT trigger another network call)
    if (eventListeners["visibilitychange"]) {
      ;(globalThis.document as unknown as { visibilityState: string }).visibilityState = "visible"
      eventListeners["visibilitychange"]()
    }
    await new Promise((r) => setTimeout(r, 10))
    expect(getCount).toBe(1)

    // Window focus listener should NOT be registered (eliminating duplicate activations)
    expect(eventListeners["focus"]).toBeUndefined()
  })

  it("reference-counts coordinator subscribers across React StrictMode mount/cleanup/remount", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let getCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync")) {
        getCount++
        return new Response(
          JSON.stringify({
            revision: 1,
            state: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    // Mount 1 (subscribers = 1)
    const stop1 = startSyncCoordinator()
    expect(eventListeners["online"]).toBeDefined()

    // StrictMode Remount: Mount 2 before cleanup of 1, or remount after
    const stop2 = startSyncCoordinator() // subscribers = 2

    // Cleanup first component (subscribers decrements to 1)
    stop1()

    // Listeners must still be active!
    expect(eventListeners["online"]).toBeDefined()

    // Online event still triggers sync
    eventListeners["online"]()
    await new Promise((r) => setTimeout(r, 10))
    expect(getCount).toBe(1)

    // Cleanup second component (subscribers decrements to 0)
    stop2()

    // Listeners must now be torn down
    expect(eventListeners["online"]).toBeUndefined()
  })

  it("does not queue a trailing sync unless syncable state changed while in-flight", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let getCount = 0
    let resolveFirstSync: (() => void) | null = null

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync")) {
        getCount++
        if (getCount === 1) {
          await new Promise<void>((resolve) => {
            resolveFirstSync = resolve
          })
        }
        return new Response(
          JSON.stringify({
            revision: 1,
            state: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    // Trigger first sync (will pause in-flight)
    const p1 = flushSync()

    // Call flushSync again while in flight without modifying state
    const p2 = flushSync()

    // Complete the first sync
    resolveFirstSync!()
    await Promise.all([p1, p2])
    await new Promise((r) => setTimeout(r, 10))

    // Because state did not change while in-flight, NO second sync was queued!
    expect(getCount).toBe(1)
  })

  it("handles HTTP 401 on sync by clearing local session and stopping repeated sync loops", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    // Populate bookmarks and device-local state
    toggleBookmark(makeMovie("tt-auth-401", "Movie 401"))
    saveRecentSearch("offline search query")
    saveDownloadedMetadata({
      id: "dl-offline-1",
      title: "Downloaded Title",
      imdbId: "tt-auth-401",
      mediaType: "movie",
      season: null,
      episode: null,
      sizeBytes: 1024,
      downloadedAt: "2026-09-01T00:00:00Z",
      completed: true,
      posterUrl: null,
    })

    let fetchCount = 0
    let logoutCalled = false

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCount++
      const { url } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync")) {
        // Return 401 Unauthorized
        return new Response(
          JSON.stringify({ error: "Unauthorized session expired" }),
          { status: 401, headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.includes("/api/auth/logout")) {
        logoutCalled = true
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    expect(getAuthSnapshot().status).toBe("authenticated")
    expect(getBookmarks().length).toBe(1)
    expect(getSyncMetadata()).not.toBeNull()

    // Trigger sync which will hit 401
    await flushSync()

    // Auth state must now be unauthenticated
    const snap = getAuthSnapshot()
    expect(snap.status).toBe("unauthenticated")
    expect(snap.user).toBeNull()

    // Sync metadata must be cleared
    expect(getSyncMetadata()).toBeNull()

    // Private syncable bookmarks cleared
    expect(getBookmarks().length).toBe(0)

    // Device-local searches and downloads preserved
    expect(loadRecentSearches()).toEqual(["offline search query"])
    expect(getDownloadedMetadata().length).toBe(1)

    // No recursive logout network call was made
    expect(logoutCalled).toBe(false)

    // Subsequent flushSync does nothing because user is unauthenticated
    const callsBefore = fetchCount
    await flushSync()
    expect(fetchCount).toBe(callsBefore)
  })

  it("refreshes lastSeenSyncableHash after remote sync so device-only writes do not trigger sync", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let putCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && method === "GET") {
        return new Response(
          JSON.stringify({
            revision: 2,
            state: {
              bookmarks: [
                {
                  imdbId: "tt-remote-fresh",
                  title: "Fresh Remote",
                  mediaType: "movie",
                  year: 2026,
                  rating: 8.5,
                  posterUrl: null,
                  backdropUrl: null,
                  genres: [],
                  bookmarkedAt: "2026-09-02T00:00:00.000Z",
                },
              ],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      if (url.includes("/api/user/sync") && method === "PUT") {
        putCount++
        return new Response(
          JSON.stringify({
            revision: 3,
            state: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    startSyncCoordinator()

    // Trigger initial clean sync to pull remote state
    await flushSync()
    expect(getBookmarks().length).toBe(1)
    expect(getBookmarks()[0].imdbId).toBe("tt-remote-fresh")

    // Now perform a device-only write (recent searches)
    saveRecentSearch("another device search")

    // Wait past debounce threshold
    await new Promise((r) => setTimeout(r, 50))

    // Because syncable state did not change and lastSeenSyncableHash was updated, NO PUT sync should fire
    expect(putCount).toBe(0)
  })

  it("flushes debounced sync when document becomes hidden or on pagehide", async () => {
    saveSyncMetadata({
      userId: mockUser.id,
      serverRevision: 1,
      baseState: {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: { ...DEFAULT_PREFERENCES },
      },
    })

    let putCount = 0
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const { url, method } = parseRequest(input, init)
      if (url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ user: mockUser, session: mockSession }), { status: 200 })
      }
      if (url.includes("/api/user/sync") && method === "PUT") {
        putCount++
        return new Response(
          JSON.stringify({
            revision: 2,
            state: {
              bookmarks: [],
              history: [],
              progress: {},
              preferences: { ...DEFAULT_PREFERENCES },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }
      return new Response("{}", { status: 200 })
    }

    const { initAuth } = await import("./auth")
    await initAuth()

    startSyncCoordinator()

    // Modify local bookmarks to trigger debounced sync schedule (5000ms)
    toggleBookmark(makeMovie("tt-hide-1", "Hidden Test Movie"))

    expect(putCount).toBe(0)

    // Document switches to hidden
    if (eventListeners["visibilitychange"]) {
      ;(globalThis.document as unknown as { visibilityState: string }).visibilityState = "hidden"
      eventListeners["visibilitychange"]()
    }

    await new Promise((r) => setTimeout(r, 10))
    // Debounced sync should have been flushed immediately!
    expect(putCount).toBe(1)

    // Modify again and test pagehide
    toggleBookmark(makeMovie("tt-hide-2", "PageHide Movie"))
    expect(putCount).toBe(1)

    if (eventListeners["pagehide"]) {
      eventListeners["pagehide"]()
    }

    await new Promise((r) => setTimeout(r, 10))
    // Debounced sync should have been flushed on pagehide as well!
    expect(putCount).toBe(2)
  })
})
