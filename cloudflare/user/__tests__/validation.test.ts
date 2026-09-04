import { describe, expect, it } from "bun:test";
import {
  DEFAULT_PREFERENCES,
  MAX_BOOKMARKS,
  MAX_HISTORY,
  MAX_PROGRESS,
} from "../types";
import {
  normalizeDeviceName,
  readJsonBody,
  sanitizePreferences,
  sanitizeUserState,
  validatePassword,
  validateSameOrigin,
  validateUsername,
} from "../validation";

describe("validation", () => {
  describe("validateUsername", () => {
    it("accepts valid usernames and normalizes to lowercase", () => {
      const res1 = validateUsername("JohnDoe");
      expect(res1.ok).toBe(true);
      if (res1.ok) expect(res1.value).toBe("johndoe");

      const res2 = validateUsername("user_name-123");
      expect(res2.ok).toBe(true);
      if (res2.ok) expect(res2.value).toBe("user_name-123");
    });

    it("rejects non-strings and invalid lengths", () => {
      expect(validateUsername(null).ok).toBe(false);
      expect(validateUsername(12345).ok).toBe(false);
      expect(validateUsername("ab").ok).toBe(false); // <3
      expect(validateUsername("a".repeat(25)).ok).toBe(false); // >24
    });

    it("rejects invalid characters", () => {
      expect(validateUsername("user@name").ok).toBe(false);
      expect(validateUsername("user.name").ok).toBe(false);
      expect(validateUsername("user name").ok).toBe(false);
      expect(validateUsername("user!").ok).toBe(false);
    });

    it("rejects reserved usernames", () => {
      expect(validateUsername("admin").ok).toBe(false);
      expect(validateUsername("api").ok).toBe(false);
      expect(validateUsername("auth").ok).toBe(false);
      expect(validateUsername("login").ok).toBe(false);
      expect(validateUsername("logout").ok).toBe(false);
      expect(validateUsername("register").ok).toBe(false);
      expect(validateUsername("u").ok).toBe(false);
      expect(validateUsername("sync").ok).toBe(false);
    });
  });

  describe("validatePassword", () => {
    it("accepts valid passwords between 10 and 128 chars", () => {
      const res = validatePassword("correct-horse-battery");
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.value).toBe("correct-horse-battery");
    });

    it("rejects non-strings, too short, or too long passwords", () => {
      expect(validatePassword(null).ok).toBe(false);
      expect(validatePassword(1234567890).ok).toBe(false);
      expect(validatePassword("short").ok).toBe(false); // 5 chars (<10)
      expect(validatePassword("a".repeat(129)).ok).toBe(false); // 129 chars (>128)
    });
  });

  describe("normalizeDeviceName", () => {
    it("normalizes and bounds device names", () => {
      expect(normalizeDeviceName("  MacBook Pro  ")).toBe("MacBook Pro");
      expect(normalizeDeviceName("")).toBe("Unknown Device");
      expect(normalizeDeviceName(null)).toBe("Unknown Device");
      expect(normalizeDeviceName(undefined)).toBe("Unknown Device");
      expect(normalizeDeviceName("a".repeat(100)).length).toBe(64);
    });
  });

  describe("validateSameOrigin", () => {
    it("accepts requests where origin matches request URL", () => {
      const req = new Request("https://hawk.local/api/auth/login", {
        headers: { origin: "https://hawk.local" },
      });
      expect(validateSameOrigin(req)).toBe(true);
    });

    it("rejects cross-origin requests", () => {
      const req = new Request("https://hawk.local/api/auth/login", {
        headers: { origin: "https://evil.com" },
      });
      expect(validateSameOrigin(req)).toBe(false);
    });

    it("falls back to referer header if origin missing", () => {
      const req1 = new Request("https://hawk.local/api/auth/login", {
        headers: { referer: "https://hawk.local/login" },
      });
      expect(validateSameOrigin(req1)).toBe(true);

      const req2 = new Request("https://hawk.local/api/auth/login", {
        headers: { referer: "https://evil.com/phish" },
      });
      expect(validateSameOrigin(req2)).toBe(false);
    });

    it("rejects requests missing both origin and referer", () => {
      const req = new Request("https://hawk.local/api/auth/login");
      expect(validateSameOrigin(req)).toBe(false);
    });
  });

  describe("readJsonBody", () => {
    it("reads valid JSON within bounds", async () => {
      const body = JSON.stringify({ hello: "world" });
      const req = new Request("https://hawk.local/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });

      const res = await readJsonBody<{ hello: string }>(req, 1024);
      expect(res.ok).toBe(true);
      expect(res.data?.hello).toBe("world");
    });

    it("rejects non-json content types", async () => {
      const req = new Request("https://hawk.local/api/test", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "test",
      });

      const res = await readJsonBody(req, 1024);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(415);
    });

    it("rejects bodies exceeding declared or actual byte limit", async () => {
      const largeData = "x".repeat(2000);
      const req = new Request("https://hawk.local/api/test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "2000",
        },
        body: JSON.stringify({ data: largeData }),
      });

      const res = await readJsonBody(req, 500);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(413);
    });

    it("rejects invalid JSON", async () => {
      const req = new Request("https://hawk.local/api/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ bad-json }",
      });

      const res = await readJsonBody(req, 1024);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(400);
    });
  });

  describe("sanitizePreferences", () => {
    it("sanitizes valid preferences", () => {
      const prefs = sanitizePreferences({
        audioLanguage: "es",
        subtitleLanguage: "en",
        subtitlesEnabled: true,
        autoResume: false,
        autoplay: true,
        defaultQuality: "1440p",
        theme: "light",
      });

      expect(prefs).toEqual({
        audioLanguage: "es",
        subtitleLanguage: "en",
        subtitlesEnabled: true,
        autoResume: false,
        autoplay: true,
        defaultQuality: "1440p",
        theme: "light",
      });
    });

    it("falls back to default preferences for missing or invalid values", () => {
      const prefs = sanitizePreferences({
        defaultQuality: "8k-unsupported",
        theme: "neon",
      });

      expect(prefs.defaultQuality).toBe(DEFAULT_PREFERENCES.defaultQuality);
      expect(prefs.theme).toBe(DEFAULT_PREFERENCES.theme);
      expect(prefs.audioLanguage).toBe("en");
    });
  });

  describe("sanitizeUserState", () => {
    it("strips unsupported domains (downloadedMetadata, recentSearches)", () => {
      const input = {
        bookmarks: [],
        history: [],
        progress: {},
        preferences: DEFAULT_PREFERENCES,
        downloadedMetadata: [{ id: "torrent-1", title: "Heavy download" }],
        recentSearches: ["secret search query"],
        unknownExtra: "should be discarded",
      };

      const sanitized = sanitizeUserState(input);
      const raw = sanitized as unknown as Record<string, unknown>;
      expect(raw.downloadedMetadata).toBe(undefined);
      expect(raw.recentSearches).toBe(undefined);
      expect(raw.unknownExtra).toBe(undefined);
    });

    it("bounds bookmarks to MAX_BOOKMARKS (200)", () => {
      const bookmarks = Array.from({ length: 250 }, (_, i) => ({
        imdbId: `tt${i}`,
        title: `Movie ${i}`,
        mediaType: "movie",
      }));

      const state = sanitizeUserState({ bookmarks });
      expect(state.bookmarks.length).toBe(MAX_BOOKMARKS);
      expect(state.bookmarks[0].imdbId).toBe("tt0");
    });

    it("bounds history to MAX_HISTORY (100)", () => {
      const history = Array.from({ length: 150 }, (_, i) => ({
        media: { id: `item-${i}`, title: `Title ${i}`, mediaType: "movie" },
        positionSeconds: 120,
        durationSeconds: 3600,
      }));

      const state = sanitizeUserState({ history });
      expect(state.history.length).toBe(MAX_HISTORY);
    });

    it("bounds progress entries to MAX_PROGRESS (200)", () => {
      const progress: Record<string, unknown> = {};
      for (let i = 0; i < 250; i++) {
        progress[`item-${i}`] = {
          id: `item-${i}`,
          imdbId: `tt${i}`,
          mediaType: "movie",
          positionSeconds: 50,
          durationSeconds: 100,
        };
      }

      const state = sanitizeUserState({ progress });
      expect(Object.keys(state.progress).length).toBe(MAX_PROGRESS);
    });

    it("rejects __proto__, constructor, and prototype keys and uses a null-prototype progress object", () => {
      const maliciousJson = JSON.parse(`{
        "progress": {
          "__proto__": { "id": "__proto__", "imdbId": "tt001", "mediaType": "movie", "positionSeconds": 1, "durationSeconds": 10 },
          "constructor": { "id": "constructor", "imdbId": "tt002", "mediaType": "movie", "positionSeconds": 1, "durationSeconds": 10 },
          "prototype": { "id": "prototype", "imdbId": "tt003", "mediaType": "movie", "positionSeconds": 1, "durationSeconds": 10 },
          "validKey": { "id": "validKey", "imdbId": "tt004", "mediaType": "movie", "positionSeconds": 1, "durationSeconds": 10 }
        }
      }`);

      const state = sanitizeUserState(maliciousJson);
      expect(Object.getPrototypeOf(state.progress)).toBeNull();
      expect(state.progress.__proto__).toBe(undefined);
      expect(state.progress.constructor).toBe(undefined);
      expect(state.progress.prototype).toBe(undefined);
      expect(state.progress.validKey).toBeDefined();
      expect(state.progress.validKey.imdbId).toBe("tt004");
    });
  });
});
