import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import {
  detectMount,
  mountAsset,
  mountBase,
  mountPath,
  parseRoute,
  setMountBase,
  toPath,
} from "./router"

describe("router mount detection & resolution", () => {
  beforeEach(() => {
    setMountBase(null)
  })

  afterEach(() => {
    setMountBase(null)
  })

  describe("detectMount", () => {
    it("detects root mount for standard top-level routes", () => {
      expect(detectMount("/")).toBe("/")
      expect(detectMount("/search")).toBe("/")
      expect(detectMount("/library")).toBe("/")
      expect(detectMount("/settings")).toBe("/")
      expect(detectMount("/login")).toBe("/")
      expect(detectMount("/u/johndoe")).toBe("/")
      expect(detectMount("/title/tt1375666")).toBe("/")
      expect(detectMount("/watch/tt1375666")).toBe("/")
      expect(detectMount("/watch/tt0903747/1/2")).toBe("/")
    })

    it("detects Streamlit mount marker /~/+/", () => {
      expect(detectMount("/~/+/")).toBe("/~/+/")
      expect(detectMount("/~/+/search")).toBe("/~/+/")
      expect(detectMount("/~/+/title/tt1375666")).toBe("/~/+/")
      expect(detectMount("/~/+/watch/tt1375666")).toBe("/~/+/")
      expect(detectMount("/~/+/watch/tt0903747/1/2")).toBe("/~/+/")
      expect(detectMount("/~/+/library")).toBe("/~/+/")
      expect(detectMount("/streamlit-host/app/~/+/search")).toBe("/streamlit-host/app/~/+/")
    })

    it("detects arbitrary mounts before known routes", () => {
      expect(detectMount("/custom-app/")).toBe("/custom-app/")
      expect(detectMount("/custom-app/search")).toBe("/custom-app/")
      expect(detectMount("/custom-app/title/tt1375666")).toBe("/custom-app/")
      expect(detectMount("/custom-app/watch/tt1375666")).toBe("/custom-app/")
      expect(detectMount("/custom-app/watch/tt0903747/3/5")).toBe("/custom-app/")
      expect(detectMount("/nested/path/to/app/library")).toBe("/nested/path/to/app/")
    })

    it("respects explicit setMountBase override", () => {
      setMountBase("/explicit-mount/")
      expect(mountBase()).toBe("/explicit-mount/")
      expect(detectMount("/anything/else")).toBe("/explicit-mount/")
    })
  })

  describe("mountPath & mountAsset", () => {
    it("formats mount-relative paths at root", () => {
      setMountBase("/")
      expect(mountPath("api/catalog/home")).toBe("/api/catalog/home")
      expect(mountPath("/api/catalog/home")).toBe("/api/catalog/home")
      expect(mountAsset("assets/poster.webp")).toBe("/assets/poster.webp")
      expect(mountAsset("/favicon.svg")).toBe("/favicon.svg")
    })

    it("formats mount-relative paths under Streamlit mount", () => {
      setMountBase("/~/+/")
      expect(mountPath("api/catalog/home")).toBe("/~/+/api/catalog/home")
      expect(mountPath("/api/catalog/search")).toBe("/~/+/api/catalog/search")
      expect(mountAsset("favicon.svg")).toBe("/~/+/favicon.svg")
    })

    it("formats mount-relative paths under arbitrary mount", () => {
      setMountBase("/my-tenant/app/")
      expect(mountPath("api/sources/tt1375666")).toBe("/my-tenant/app/api/sources/tt1375666")
      expect(mountAsset("logo.svg")).toBe("/my-tenant/app/logo.svg")
    })
  })
})

describe("router parseRoute & toPath", () => {
  describe("root mount routes", () => {
    const base = "/"

    it("parses home route /", () => {
      const route = parseRoute("/", base)
      expect(route).toEqual({ name: "home" })
      expect(toPath(route, base)).toBe("/")
    })

    it("parses search route /search", () => {
      const route = parseRoute("/search", base)
      expect(route).toEqual({ name: "search" })
      expect(toPath(route, base)).toBe("/search")
    })

    it("parses title route /title/:imdbId", () => {
      const route = parseRoute("/title/tt1375666", base)
      expect(route).toEqual({
        name: "title",
        imdbId: "tt1375666",
        id: "tt1375666",
        type: "movie",
      })
      expect(toPath(route, base)).toBe("/title/tt1375666")
    })

    it("parses watch movie route /watch/:imdbId", () => {
      const route = parseRoute("/watch/tt1375666", base)
      expect(route).toEqual({
        name: "watch",
        imdbId: "tt1375666",
      })
      expect(toPath(route, base)).toBe("/watch/tt1375666")
    })

    it("parses watch episode route /watch/:imdbId/:season/:episode", () => {
      const route = parseRoute("/watch/tt0903747/1/2", base)
      expect(route).toEqual({
        name: "watch",
        imdbId: "tt0903747",
        season: 1,
        episode: 2,
      })
      expect(toPath(route, base)).toBe("/watch/tt0903747/1/2")
    })

    it("parses library route /library", () => {
      const route = parseRoute("/library", base)
      expect(route).toEqual({ name: "library" })
      expect(toPath(route, base)).toBe("/library")
    })

    it("parses settings route /settings", () => {
      const route = parseRoute("/settings", base)
      expect(route).toEqual({ name: "settings" })
      expect(toPath(route, base)).toBe("/settings")
    })

    it("parses login route /login", () => {
      const route = parseRoute("/login", base)
      expect(route).toEqual({ name: "login" })
      expect(toPath(route, base)).toBe("/login")
    })

    it("parses profile route /u/:username", () => {
      const route = parseRoute("/u/testuser", base)
      expect(route).toEqual({ name: "profile", username: "testuser" })
      expect(toPath(route, base)).toBe("/u/testuser")
    })

    it("handles legacy /pick and legacy app title routes", () => {
      expect(parseRoute("/pick", base)).toEqual({ name: "home" })
      expect(parseRoute("/app/movie/tt1375666", base)).toEqual({
        name: "title",
        imdbId: "tt1375666",
        id: "tt1375666",
        type: "movie",
      })
      expect(parseRoute("/app/tv/tt0903747/sources", base)).toEqual({
        name: "title",
        imdbId: "tt0903747",
        id: "tt0903747",
        type: "tv",
      })
    })

    it("falls back to home route for unrecognized paths", () => {
      expect(parseRoute("/nonexistent/deep/path/to/nowhere", base)).toEqual({ name: "home" })
    })
  })

  describe("arbitrary mount routes", () => {
    const base = "/custom/mount/"

    it("parses and formats all routes under arbitrary mount", () => {
      expect(parseRoute("/custom/mount/", base)).toEqual({ name: "home" })
      expect(toPath({ name: "home" }, base)).toBe("/custom/mount/")

      expect(parseRoute("/custom/mount/search", base)).toEqual({ name: "search" })
      expect(toPath({ name: "search" }, base)).toBe("/custom/mount/search")

      expect(parseRoute("/custom/mount/title/tt1375666", base)).toEqual({
        name: "title",
        imdbId: "tt1375666",
        id: "tt1375666",
        type: "movie",
      })
      expect(toPath({ name: "title", imdbId: "tt1375666", id: "tt1375666", type: "movie" }, base)).toBe(
        "/custom/mount/title/tt1375666"
      )

      expect(parseRoute("/custom/mount/watch/tt1375666", base)).toEqual({
        name: "watch",
        imdbId: "tt1375666",
      })
      expect(toPath({ name: "watch", imdbId: "tt1375666" }, base)).toBe("/custom/mount/watch/tt1375666")

      expect(parseRoute("/custom/mount/watch/tt0903747/2/4", base)).toEqual({
        name: "watch",
        imdbId: "tt0903747",
        season: 2,
        episode: 4,
      })
      expect(
        toPath({ name: "watch", imdbId: "tt0903747", season: 2, episode: 4 }, base)
      ).toBe("/custom/mount/watch/tt0903747/2/4")

      expect(parseRoute("/custom/mount/library", base)).toEqual({ name: "library" })
      expect(toPath({ name: "library" }, base)).toBe("/custom/mount/library")

      expect(parseRoute("/custom/mount/settings", base)).toEqual({ name: "settings" })
      expect(toPath({ name: "settings" }, base)).toBe("/custom/mount/settings")

      expect(parseRoute("/custom/mount/login", base)).toEqual({ name: "login" })
      expect(toPath({ name: "login" }, base)).toBe("/custom/mount/login")

      expect(parseRoute("/custom/mount/u/alice", base)).toEqual({ name: "profile", username: "alice" })
      expect(toPath({ name: "profile", username: "alice" }, base)).toBe("/custom/mount/u/alice")
    })
  })

  describe("Streamlit mount routes", () => {
    const base = "/~/+/"

    it("parses and formats all routes under Streamlit mount", () => {
      expect(parseRoute("/~/+/", base)).toEqual({ name: "home" })
      expect(toPath({ name: "home" }, base)).toBe("/~/+/")

      expect(parseRoute("/~/+/search", base)).toEqual({ name: "search" })
      expect(toPath({ name: "search" }, base)).toBe("/~/+/search")

      expect(parseRoute("/~/+/title/tt1375666", base)).toEqual({
        name: "title",
        imdbId: "tt1375666",
        id: "tt1375666",
        type: "movie",
      })
      expect(toPath({ name: "title", imdbId: "tt1375666", id: "tt1375666", type: "movie" }, base)).toBe(
        "/~/+/title/tt1375666"
      )

      expect(parseRoute("/~/+/watch/tt0903747/1/1", base)).toEqual({
        name: "watch",
        imdbId: "tt0903747",
        season: 1,
        episode: 1,
      })
      expect(
        toPath({ name: "watch", imdbId: "tt0903747", season: 1, episode: 1 }, base)
      ).toBe("/~/+/watch/tt0903747/1/1")

      expect(parseRoute("/~/+/library", base)).toEqual({ name: "library" })
      expect(toPath({ name: "library" }, base)).toBe("/~/+/library")

      expect(parseRoute("/~/+/settings", base)).toEqual({ name: "settings" })
      expect(toPath({ name: "settings" }, base)).toBe("/~/+/settings")

      expect(parseRoute("/~/+/login", base)).toEqual({ name: "login" })
      expect(toPath({ name: "login" }, base)).toBe("/~/+/login")

      expect(parseRoute("/~/+/u/bob", base)).toEqual({ name: "profile", username: "bob" })
      expect(toPath({ name: "profile", username: "bob" }, base)).toBe("/~/+/u/bob")
    })
  })

})
