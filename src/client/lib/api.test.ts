import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  ApiError,
  clearDeduplicationCache,
  createPlayback,
  deletePlayback,
  errorMessage,
  fetchCatalogEpisodes,
  fetchCatalogHome,
  fetchCatalogTitle,
  fetchPlaybackSources,
  fetchPlaybackStatus,
  fetchSubtitles,
  getMe,
  getPublicProfile,
  getSessions,
  getSync,
  getUserProfile,
  isAbort,
  isSyncConflict,
  login,
  logout,
  putSync,
  register,
  revokeSession,
  searchCatalog,
  streamUrl,
  updateUserProfile,
} from "./api"
import { setMountBase } from "./router"

describe("normalized API client", () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setMountBase(null)
    clearDeduplicationCache()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setMountBase(null)
    clearDeduplicationCache()
  })

  describe("error handling and ApiError", () => {
    it("extracts robust JSON errors", async () => {
      globalThis.fetch = async () =>
        new Response(JSON.stringify({ error: "Catalog item not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        })

      try {
        await fetchCatalogTitle("tt0000000")
        expect().unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(404)
        expect((err as ApiError).message).toBe("Catalog item not found")
        expect(errorMessage(err)).toBe("Catalog item not found")
      }
    })

    it("falls back to text when JSON is not returned", async () => {
      globalThis.fetch = async () =>
        new Response("Gateway timeout", {
          status: 504,
          statusText: "Gateway Timeout",
          headers: { "Content-Type": "text/plain" },
        })

      try {
        await fetchCatalogHome()
        expect().unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(504)
        expect((err as ApiError).message).toBe("Gateway timeout")
      }
    })

    it("handles AbortSignal aborts and recognizes isAbort", async () => {
      globalThis.fetch = async (_url, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError")
        }
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"))
          })
        })
      }

      const controller = new AbortController()
      controller.abort()

      try {
        await fetchCatalogHome(controller.signal)
        expect().unreachable()
      } catch (err) {
        expect(isAbort(err)).toBe(true)
      }
    })
  })

  describe("request deduplication for safe GETs", () => {
    it("deduplicates concurrent identical GET requests", async () => {
      let callCount = 0

      globalThis.fetch = async () => {
        callCount++
        await new Promise((res) => setTimeout(res, 20))
        return new Response(JSON.stringify({ sections: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      const [res1, res2, res3] = await Promise.all([
        fetchCatalogHome(),
        fetchCatalogHome(),
        fetchCatalogHome(),
      ])

      expect(callCount).toBe(1)
      expect(res1).toEqual({ sections: [] })
      expect(res2).toEqual({ sections: [] })
      expect(res3).toEqual({ sections: [] })
    })

    it("allows one caller to abort without cancelling shared work", async () => {
      let callCount = 0
      globalThis.fetch = async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 20))
        return Response.json({ sections: [] })
      }

      const controller = new AbortController()
      const aborted = fetchCatalogHome(controller.signal)
      const completed = fetchCatalogHome()
      controller.abort()

      try {
        await aborted
        expect().unreachable()
      } catch (error) {
        expect(isAbort(error)).toBe(true)
      }
      expect(await completed).toEqual({ sections: [] })
      expect(callCount).toBe(1)
    })

    it("does not deduplicate POST or DELETE requests", async () => {
      let postCount = 0

      globalThis.fetch = async () => {
        postCount++
        return new Response(
          JSON.stringify({
            id: `pb-${postCount}`,
            target: { imdbId: "tt1", mediaType: "movie", season: null, episode: null },
            source: { name: "test", magnet: "magnet:?", quality: "1080p", seeds: 10, sizeBytes: 1000 },
            status: {
              progress: 0,
              downloadedBytes: 0,
              totalBytes: 1000,
              peers: 0,
              downloadSpeed: 0,
              ready: false,
              complete: false,
              state: "resolving",
              error: null,
              subtitles: [],
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      }

      await Promise.all([
        createPlayback({
          target: { imdbId: "tt1", mediaType: "movie", season: null, episode: null },
          source: { name: "test", magnet: "magnet:?", quality: "1080p", seeds: 10, sizeBytes: 1000 },
        }),
        createPlayback({
          target: { imdbId: "tt1", mediaType: "movie", season: null, episode: null },
          source: { name: "test", magnet: "magnet:?", quality: "1080p", seeds: 10, sizeBytes: 1000 },
        }),
      ])

      expect(postCount).toBe(2)
    })
  })

  describe("mount-relative endpoint paths & methods", () => {
    it("requests mount-relative URLs under arbitrary mount", async () => {
      setMountBase("/tenant/mount/")
      const requestedUrls: string[] = []

      globalThis.fetch = async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input))
        return new Response(JSON.stringify({ ok: true, results: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      await searchCatalog({ query: "matrix", type: "movie" })
      await fetchPlaybackSources("tt1375666")
      await fetchCatalogEpisodes("tt0903747", 1)
      await fetchPlaybackStatus("pb-123")
      await fetchSubtitles("pb-123")
      await deletePlayback("pb-123")

      expect(requestedUrls[0]).toBe("/tenant/mount/api/catalog/search?q=matrix&type=movie")
      expect(requestedUrls[1]).toBe("/tenant/mount/api/sources?imdbId=tt1375666&mediaType=movie&title=tt1375666")
      expect(requestedUrls[2]).toBe("/tenant/mount/api/catalog/episodes/tt0903747/1")
      expect(requestedUrls[3]).toBe("/tenant/mount/api/playback/pb-123")
      expect(requestedUrls[4]).toBe("/tenant/mount/api/playback/pb-123/subtitles")
      expect(requestedUrls[5]).toBe("/tenant/mount/api/playback/pb-123")
    })

    it("formats streamUrl mount-relatively with optional file index", () => {
      setMountBase("/tenant/mount/")
      expect(streamUrl("pb-123")).toBe("/tenant/mount/api/stream/pb-123")
      expect(streamUrl("pb-123", 2)).toBe("/tenant/mount/api/stream/pb-123/2")
    })
  })

  describe("account and sync API endpoints", () => {
    it("sends same-origin credentials and correct payloads for auth endpoints", async () => {
      const calls: { url: string; method: string; credentials?: RequestCredentials; body?: string }[] = []

      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          url: String(input),
          method: init?.method || "GET",
          credentials: init?.credentials,
          body: init?.body ? String(init.body) : undefined,
        })

        if (String(input).includes("/api/auth/register")) {
          return new Response(
            JSON.stringify({
              user: { id: "u1", username: "alice", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s1", deviceName: "Chrome on macOS", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        }

        if (String(input).includes("/api/auth/login")) {
          return new Response(
            JSON.stringify({
              user: { id: "u1", username: "alice", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s2", deviceName: "Chrome on macOS", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        if (String(input).includes("/api/auth/me")) {
          return new Response(
            JSON.stringify({
              user: { id: "u1", username: "alice", createdAt: "2026-09-01T00:00:00Z", publicProfile: false },
              session: { id: "s1", deviceName: "Chrome on macOS", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        if (String(input).includes("/api/auth/sessions/s2")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        if (String(input).includes("/api/auth/sessions")) {
          return new Response(
            JSON.stringify({
              sessions: [
                { id: "s1", deviceName: "Chrome", createdAt: "2026-09-01T00:00:00Z", expiresAt: "2026-10-01T00:00:00Z", isCurrent: true },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        if (String(input).includes("/api/auth/logout")) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }

        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })
      }

      await register({ username: "alice", password: "password123", deviceName: "Chrome on macOS" })
      expect(calls[0].url).toBe("/api/auth/register")
      expect(calls[0].method).toBe("POST")
      expect(calls[0].credentials).toBe("same-origin")
      expect(JSON.parse(calls[0].body!)).toEqual({ username: "alice", password: "password123", deviceName: "Chrome on macOS" })

      await login({ username: "alice", password: "password123", deviceName: "Chrome on macOS" })
      expect(calls[1].url).toBe("/api/auth/login")
      expect(calls[1].method).toBe("POST")

      await getMe()
      expect(calls[2].url).toBe("/api/auth/me")
      expect(calls[2].method).toBe("GET")

      const sessions = await getSessions()
      expect(sessions.length).toBe(1)
      expect(calls[3].url).toBe("/api/auth/sessions")

      await revokeSession("s2")
      expect(calls[4].url).toBe("/api/auth/sessions/s2")
      expect(calls[4].method).toBe("DELETE")

      await logout()
      expect(calls[5].url).toBe("/api/auth/logout")
      expect(calls[5].method).toBe("POST")
    })

    it("sends sync requests and detects 409 conflict correctly", async () => {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/api/user/sync") && init?.method === "PUT") {
          return new Response(
            JSON.stringify({
              error: "Conflict detected: server revision advanced",
              code: "CONFLICT",
              serverRevision: 2,
              serverState: {
                bookmarks: [],
                history: [],
                progress: {},
                preferences: {
                  audioLanguage: "en",
                  subtitleLanguage: "en",
                  subtitlesEnabled: false,
                  autoResume: true,
                  autoplay: true,
                  defaultQuality: "1080p",
                  theme: "dark",
                },
              },
            }),
            { status: 409, headers: { "Content-Type": "application/json" } }
          )
        }

        if (url.includes("/api/user/sync")) {
          return new Response(
            JSON.stringify({
              revision: 1,
              state: {
                bookmarks: [],
                history: [],
                progress: {},
                preferences: {
                  audioLanguage: "en",
                  subtitleLanguage: "en",
                  subtitlesEnabled: false,
                  autoResume: true,
                  autoplay: true,
                  defaultQuality: "1080p",
                  theme: "dark",
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        return new Response("{}", { status: 200 })
      }

      const syncData = await getSync()
      expect(syncData.revision).toBe(1)

      try {
        await putSync(0, syncData.state)
        expect().unreachable()
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(409)
        expect(isSyncConflict(err)).toBe(true)
        if (isSyncConflict(err)) {
          expect(err.details.serverRevision).toBe(2)
        }
      }
    })

    it("fetches and updates user profile and public profile", async () => {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/api/user/profile") && init?.method === "PATCH") {
          const body = JSON.parse(String(init.body))
          return new Response(
            JSON.stringify({ username: "alice", publicProfile: body.publicProfile }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        if (url.includes("/api/user/profile")) {
          return new Response(
            JSON.stringify({ username: "alice", publicProfile: false }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        if (url.includes("/api/public/profile/alice")) {
          return new Response(
            JSON.stringify({
              user: { username: "alice", createdAt: "2026-09-01T00:00:00Z" },
              bookmarks: [],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        }

        return new Response("{}", { status: 200 })
      }

      const prof = await getUserProfile()
      expect(prof.username).toBe("alice")
      expect(prof.publicProfile).toBe(false)

      const updated = await updateUserProfile({ publicProfile: true })
      expect(updated.publicProfile).toBe(true)

      const pub = await getPublicProfile("alice")
      expect(pub.user.username).toBe("alice")
      expect(pub.bookmarks).toEqual([])
    })
  })
})
