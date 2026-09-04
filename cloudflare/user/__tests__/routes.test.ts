import { describe, expect, it } from "bun:test";
import { COOKIE_NAME } from "../session";
import { handleUserRequest } from "../routes";
import type { UserEnv } from "../types";
import { createMockD1 } from "./d1-mock";

function createTestEnv(overrides: Partial<UserEnv> = {}): UserEnv {
  return {
    DB: createMockD1(),
    ...overrides,
  };
}

const ORIGIN = "https://hawk.local";

function makeJsonRequest(
  path: string,
  method: string,
  body?: unknown,
  cookie?: string
): Request {
  const headers: Record<string, string> = {
    origin: ORIGIN,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (cookie) {
    headers["cookie"] = cookie;
  }

  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") || "";
  const match = setCookie.match(/hawk_session=([a-f0-9]{64})/);
  if (!match) {
    throw new Error(`Session cookie not found in response: ${setCookie}`);
  }
  return `${COOKIE_NAME}=${match[1]}`;
}

describe("handleUserRequest", () => {
  describe("unhandled routes", () => {
    it("returns null for non-user paths", async () => {
      const env = createTestEnv();
      const req = new Request(`${ORIGIN}/api/catalog/search`);
      const res = await handleUserRequest(req, env);
      expect(res).toBeNull();
    });

    it("returns null for /u/:username SPA client route to prevent collision", async () => {
      const env = createTestEnv();
      const req = new Request(`${ORIGIN}/u/anyuser`);
      const res = await handleUserRequest(req, env);
      expect(res).toBeNull();
    });
  });

  describe("mount prefix normalization", () => {
    it("strips leading /~/+ mount prefix before routing", async () => {
      const env = createTestEnv();
      const req = makeJsonRequest("/~/+/api/auth/register", "POST", {
        username: "mounteduser",
        password: "password12345",
      });
      const res = await handleUserRequest(req, env);
      expect(res?.status).toBe(201);

      const loginReq = makeJsonRequest("/~/+/api/auth/login", "POST", {
        username: "mounteduser",
        password: "password12345",
      });
      const loginRes = await handleUserRequest(loginReq, env);
      expect(loginRes?.status).toBe(200);
    });
  });

  describe("registration", () => {
    it("rejects cross-origin requests", async () => {
      const env = createTestEnv();
      const req = new Request(`${ORIGIN}/api/auth/register`, {
        method: "POST",
        headers: {
          origin: "https://attacker.com",
          "content-type": "application/json",
        },
        body: JSON.stringify({ username: "alice123", password: "password12345" }),
      });

      const res = await handleUserRequest(req, env);
      expect(res?.status).toBe(403);
    });

    it("rejects invalid or reserved usernames", async () => {
      const env = createTestEnv();

      // Reserved
      const req1 = makeJsonRequest("/api/auth/register", "POST", {
        username: "admin",
        password: "password12345",
      });
      const res1 = await handleUserRequest(req1, env);
      expect(res1?.status).toBe(400);
      const json1 = (await res1?.json()) as { code: string };
      expect(json1.code).toBe("INVALID_USERNAME");

      // Too short
      const req2 = makeJsonRequest("/api/auth/register", "POST", {
        username: "al",
        password: "password12345",
      });
      const res2 = await handleUserRequest(req2, env);
      expect(res2?.status).toBe(400);
    });

    it("rejects short passwords", async () => {
      const env = createTestEnv();
      const req = makeJsonRequest("/api/auth/register", "POST", {
        username: "validuser",
        password: "short",
      });
      const res = await handleUserRequest(req, env);
      expect(res?.status).toBe(400);
      const json = (await res?.json()) as { code: string };
      expect(json.code).toBe("INVALID_PASSWORD");
    });

    it("registers user successfully, creates session and user_state", async () => {
      const env = createTestEnv();
      const req = makeJsonRequest("/api/auth/register", "POST", {
        username: "Alice_99",
        password: "password12345",
        deviceName: "MacBook Air",
      });

      const res = await handleUserRequest(req, env);
      expect(res?.status).toBe(201);
      expect(res?.headers.get("cache-control")).toContain("no-store");
      expect(res?.headers.get("set-cookie")).toContain(COOKIE_NAME);

      const json = (await res?.json()) as {
        user: { username: string; publicProfile: boolean };
        session: { deviceName: string };
      };
      expect(json.user.username).toBe("alice_99"); // Normalized lowercase
      expect(json.user.publicProfile).toBe(false); // Private by default
      expect(json.session.deviceName).toBe("MacBook Air");

      // Verify user_state is initialized at revision 0
      const stateRow = await env.DB.prepare(
        "SELECT revision FROM user_state WHERE user_id = (SELECT id FROM users WHERE username = ?)"
      )
        .bind("alice_99")
        .first<{ revision: number }>();
      expect(stateRow?.revision).toBe(0);
    });

    it("rejects duplicate username (409)", async () => {
      const env = createTestEnv();
      const req1 = makeJsonRequest("/api/auth/register", "POST", {
        username: "bob1234",
        password: "password12345",
      });
      await handleUserRequest(req1, env);

      const req2 = makeJsonRequest("/api/auth/register", "POST", {
        username: "BOB1234", // Case insensitive collision
        password: "password12345",
      });
      const res2 = await handleUserRequest(req2, env);
      expect(res2?.status).toBe(409);
      const json2 = (await res2?.json()) as { code: string };
      expect(json2.code).toBe("USERNAME_TAKEN");
    });

    it("handles concurrent duplicate registration race via batch conflict mapping to 409 USERNAME_TAKEN", async () => {
      const baseDb = createMockD1();
      // Simulate race condition: pre-check SELECT returns null (doesn't find user),
      // but the batch insert fails with SQLite UNIQUE constraint violation
      let first = true;
      const raceDb = {
        ...baseDb,
        prepare(sql: string) {
          const stmt = baseDb.prepare(sql);
          if (sql.includes("SELECT id FROM users WHERE username = ?")) {
            return {
              bind: (...args: unknown[]) => stmt.bind(...args),
              first: async () => null, // pre-check pretends user does not exist
              run: stmt.run.bind(stmt),
              all: stmt.all.bind(stmt),
              raw: stmt.raw.bind(stmt),
            };
          }
          return stmt;
        },
        async batch<T = unknown>(statements: Parameters<typeof baseDb.batch>[0]) {
          if (first) {
            first = false;
            return baseDb.batch<T>(statements);
          }
          // Second concurrent registration encounters UNIQUE constraint failed
          throw new Error("D1_ERROR: UNIQUE constraint failed: users.username");
        },
      };

      const env = createTestEnv({ DB: raceDb as typeof env.DB });
      const req1 = makeJsonRequest("/api/auth/register", "POST", {
        username: "racer_user",
        password: "password12345",
      });
      const res1 = await handleUserRequest(req1, env);
      expect(res1?.status).toBe(201);

      const req2 = makeJsonRequest("/api/auth/register", "POST", {
        username: "racer_user",
        password: "password12345",
      });
      const res2 = await handleUserRequest(req2, env);
      expect(res2?.status).toBe(409);
      const json2 = (await res2?.json()) as { code: string };
      expect(json2.code).toBe("USERNAME_TAKEN");
    });

    it("enforces dedicated auth rate limiter with namespaced key and no fallback to API_RATE_LIMITER", async () => {
      let authLimiterKey = "";
      let apiLimiterCalled = false;
      const env = createTestEnv({
        AUTH_RATE_LIMITER: {
          limit: async ({ key }) => {
            authLimiterKey = key;
            return { success: false };
          },
        },
        API_RATE_LIMITER: {
          limit: async () => {
            apiLimiterCalled = true;
            return { success: false };
          },
        },
      });

      const req = makeJsonRequest("/api/auth/register", "POST", {
        username: "charlie1",
        password: "password12345",
      });
      const res = await handleUserRequest(req, env);
      expect(authLimiterKey).toBe("auth:register:127.0.0.1");
      expect(apiLimiterCalled).toBe(false);
      expect(res?.status).toBe(429);

      // Verify auth routes do NOT fall back to API_RATE_LIMITER if AUTH_RATE_LIMITER is undefined
      const noAuthEnv = createTestEnv({
        API_RATE_LIMITER: {
          limit: async () => {
            apiLimiterCalled = true;
            return { success: false };
          },
        },
      });
      const reqFallback = makeJsonRequest("/api/auth/register", "POST", {
        username: "charlie2",
        password: "password12345",
      });
      const resFallback = await handleUserRequest(reqFallback, noAuthEnv);
      expect(apiLimiterCalled).toBe(false);
      expect(resFallback?.status).toBe(201);
    });
  });

  describe("login and logout", () => {
    it("handles login with correct credentials and rejects incorrect ones", async () => {
      const env = createTestEnv();
      // Register
      await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "dave1234",
          password: "password12345",
        }),
        env
      );

      // Wrong password
      const badReq = makeJsonRequest("/api/auth/login", "POST", {
        username: "dave1234",
        password: "WrongPassword999",
      });
      const badRes = await handleUserRequest(badReq, env);
      expect(badRes?.status).toBe(401);

      // Correct password
      const goodReq = makeJsonRequest("/api/auth/login", "POST", {
        username: "Dave1234",
        password: "password12345",
        deviceName: "Firefox",
      });
      const goodRes = await handleUserRequest(goodReq, env);
      expect(goodRes?.status).toBe(200);
      expect(goodRes?.headers.get("set-cookie")).toContain(COOKIE_NAME);

      // Nonexistent user uses dummy hash and returns 401 with same error contract
      const noUserReq = makeJsonRequest("/api/auth/login", "POST", {
        username: "nonexistent_user",
        password: "password12345",
      });
      const noUserRes = await handleUserRequest(noUserReq, env);
      expect(noUserRes?.status).toBe(401);
      const noUserJson = (await noUserRes?.json()) as { code: string };
      expect(noUserJson.code).toBe("INVALID_CREDENTIALS");
    });

    it("enforces dedicated auth rate limiter on login with auth:login namespace", async () => {
      let authLimiterKey = "";
      const env = createTestEnv({
        AUTH_RATE_LIMITER: {
          limit: async ({ key }) => {
            authLimiterKey = key;
            return { success: false };
          },
        },
      });

      const req = makeJsonRequest("/api/auth/login", "POST", {
        username: "any_user",
        password: "password12345",
      });
      const res = await handleUserRequest(req, env);
      expect(authLimiterKey).toBe("auth:login:127.0.0.1");
      expect(res?.status).toBe(429);
    });

    it("logs out and clears session", async () => {
      const env = createTestEnv();
      const regRes = await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "eve12345",
          password: "password12345",
        }),
        env
      );
      const cookie = extractCookie(regRes!);

      // Me works
      const meRes1 = await handleUserRequest(
        new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie } }),
        env
      );
      expect(meRes1?.status).toBe(200);

      // Logout
      const logoutRes = await handleUserRequest(
        makeJsonRequest("/api/auth/logout", "POST", undefined, cookie),
        env
      );
      expect(logoutRes?.status).toBe(200);
      expect(logoutRes?.headers.get("set-cookie")).toContain("Max-Age=0");

      // Me now fails (401)
      const meRes2 = await handleUserRequest(
        new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie } }),
        env
      );
      expect(meRes2?.status).toBe(401);
    });
  });

  describe("sessions management", () => {
    it("lists sessions and revokes owner session", async () => {
      const env = createTestEnv();
      const regRes = await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "frankie1",
          password: "password12345",
          deviceName: "Device 1",
        }),
        env
      );
      const cookie1 = extractCookie(regRes!);

      // Login second device
      const loginRes = await handleUserRequest(
        makeJsonRequest("/api/auth/login", "POST", {
          username: "frankie1",
          password: "password12345",
          deviceName: "Device 2",
        }),
        env
      );
      const cookie2 = extractCookie(loginRes!);

      // List sessions from device 2
      const listReq = new Request(`${ORIGIN}/api/auth/sessions`, {
        headers: { cookie: cookie2 },
      });
      const listRes = await handleUserRequest(listReq, env);
      expect(listRes?.status).toBe(200);
      const listJson = (await listRes?.json()) as {
        sessions: { id: string; deviceName: string; isCurrent: boolean }[];
      };
      expect(listJson.sessions.length).toBe(2);

      const s2 = listJson.sessions.find((s) => s.isCurrent);
      expect(s2?.deviceName).toBe("Device 2");

      const s1 = listJson.sessions.find((s) => !s.isCurrent);
      expect(s1?.deviceName).toBe("Device 1");

      // Revoke device 1 session
      const revokeReq = makeJsonRequest(
        `/api/auth/sessions/${s1!.id}`,
        "DELETE",
        undefined,
        cookie2
      );
      const revokeRes = await handleUserRequest(revokeReq, env);
      expect(revokeRes?.status).toBe(200);

      // Device 1 is now unauthorized
      const me1 = await handleUserRequest(
        new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: cookie1 } }),
        env
      );
      expect(me1?.status).toBe(401);

      // Device 2 is still valid
      const me2 = await handleUserRequest(
        new Request(`${ORIGIN}/api/auth/me`, { headers: { cookie: cookie2 } }),
        env
      );
      expect(me2?.status).toBe(200);
    });
  });

  describe("state sync with optimistic concurrency", () => {
    it("handles sync lifecycle and 409 conflict detection", async () => {
      const env = createTestEnv();
      const regRes = await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "grace123",
          password: "password12345",
        }),
        env
      );
      const cookie = extractCookie(regRes!);

      // Initial GET sync -> rev 0
      const syncGet1 = await handleUserRequest(
        new Request(`${ORIGIN}/api/user/sync`, { headers: { cookie } }),
        env
      );
      expect(syncGet1?.status).toBe(200);
      expect(syncGet1?.headers.get("cache-control")).toContain("no-store");
      const getJson1 = (await syncGet1?.json()) as { revision: number; state: { bookmarks: unknown[] } };
      expect(getJson1.revision).toBe(0);
      expect(getJson1.state.bookmarks).toEqual([]);

      // PUT sync with baseRevision 0 -> updates to rev 1
      const newState1 = {
        bookmarks: [
          {
            imdbId: "tt1375666",
            title: "Inception",
            mediaType: "movie",
            year: 2010,
          },
        ],
        history: [],
        progress: {},
        preferences: { theme: "dark" },
        // These should be completely dropped!
        recentSearches: ["test search"],
        downloadedMetadata: [{ id: "torrent-xyz" }],
      };

      const syncPut1 = await handleUserRequest(
        makeJsonRequest("/api/user/sync", "PUT", {
          baseRevision: 0,
          state: newState1,
        }, cookie),
        env
      );
      expect(syncPut1?.status).toBe(200);
      const putJson1 = (await syncPut1?.json()) as {
        revision: number;
        state: { bookmarks: { imdbId: string }[]; recentSearches?: unknown };
      };
      expect(putJson1.revision).toBe(1);
      expect(putJson1.state.bookmarks.length).toBe(1);
      expect(putJson1.state.bookmarks[0].imdbId).toBe("tt1375666");
      expect(putJson1.state.recentSearches).toBe(undefined);

      // Conflicting PUT with stale baseRevision (baseRevision: 0 when server is at 1) -> 409
      const stalePut = await handleUserRequest(
        makeJsonRequest("/api/user/sync", "PUT", {
          baseRevision: 0,
          state: { bookmarks: [] },
        }, cookie),
        env
      );
      expect(stalePut?.status).toBe(409);
      const conflictJson = (await stalePut?.json()) as {
        code: string;
        serverRevision: number;
        serverState: { bookmarks: { imdbId: string }[] };
      };
      expect(conflictJson.code).toBe("CONFLICT");
      expect(conflictJson.serverRevision).toBe(1);
      expect(conflictJson.serverState.bookmarks[0].imdbId).toBe("tt1375666");

      // Successful update with baseRevision: 1 -> updates to rev 2
      const syncPut2 = await handleUserRequest(
        makeJsonRequest("/api/user/sync", "PUT", {
          baseRevision: 1,
          state: {
            ...newState1,
            bookmarks: [
              ...newState1.bookmarks,
              { imdbId: "tt0816692", title: "Interstellar", mediaType: "movie" },
            ],
          },
        }, cookie),
        env
      );
      expect(syncPut2?.status).toBe(200);
      const putJson2 = (await syncPut2?.json()) as { revision: number; state: { bookmarks: unknown[] } };
      expect(putJson2.revision).toBe(2);
      expect(putJson2.state.bookmarks.length).toBe(2);
    });
  });

  describe("profile settings and public profile (/api/public/profile/:username)", () => {
    it("keeps profile private by default and exposes only normalized identity & bookmarks when public", async () => {
      const env = createTestEnv();
      const regRes = await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "heidi_99",
          password: "password12345",
        }),
        env
      );
      const cookie = extractCookie(regRes!);

      // Add a bookmark and progress/history to state
      await handleUserRequest(
        makeJsonRequest("/api/user/sync", "PUT", {
          baseRevision: 0,
          state: {
            bookmarks: [
              { imdbId: "tt0111161", title: "The Shawshank Redemption", mediaType: "movie" },
            ],
            history: [
              {
                media: { id: "tt0111161", title: "The Shawshank Redemption", mediaType: "movie" },
                positionSeconds: 100,
                durationSeconds: 8000,
              },
            ],
            progress: {
              tt0111161: {
                id: "tt0111161",
                imdbId: "tt0111161",
                mediaType: "movie",
                positionSeconds: 100,
                durationSeconds: 8000,
              },
            },
          },
        }, cookie),
        env
      );

      // Private by default -> GET /api/public/profile/heidi_99 should return 404 with private, no-store
      const pubReq1 = new Request(`${ORIGIN}/api/public/profile/heidi_99`);
      const pubRes1 = await handleUserRequest(pubReq1, env);
      expect(pubRes1?.status).toBe(404);
      expect(pubRes1?.headers.get("cache-control")).toBe("private, no-store");

      // Enable public profile via PATCH /api/user/profile
      const patchRes = await handleUserRequest(
        makeJsonRequest("/api/user/profile", "PATCH", { publicProfile: true }, cookie),
        env
      );
      expect(patchRes?.status).toBe(200);

      // Now GET /api/public/profile/heidi_99 succeeds with public, max-age=15, must-revalidate
      const pubReq2 = new Request(`${ORIGIN}/api/public/profile/heidi_99`);
      const pubRes2 = await handleUserRequest(pubReq2, env);
      expect(pubRes2?.status).toBe(200);
      expect(pubRes2?.headers.get("cache-control")).toBe("public, max-age=15, must-revalidate");
      const etag = pubRes2?.headers.get("etag");
      expect(etag).not.toBeNull();

      const pubJson = (await pubRes2?.json()) as {
        user: { username: string; createdAt: number };
        bookmarks: { imdbId: string; title: string }[];
        history?: unknown;
        progress?: unknown;
        preferences?: unknown;
      };
      expect(pubJson.user.username).toBe("heidi_99");
      expect(pubJson.bookmarks.length).toBe(1);
      expect(pubJson.bookmarks[0].imdbId).toBe("tt0111161");

      // Verify privacy guarantee: never expose history, progress, preferences, sessions
      expect(pubJson.history).toBe(undefined);
      expect(pubJson.progress).toBe(undefined);
      expect(pubJson.preferences).toBe(undefined);

      // Test ETag cache validation: If-None-Match returns 304 with public, max-age=15, must-revalidate
      const cachedReq = new Request(`${ORIGIN}/api/public/profile/heidi_99`, {
        headers: { "if-none-match": etag! },
      });
      const cachedRes = await handleUserRequest(cachedReq, env);
      expect(cachedRes?.status).toBe(304);
      expect(cachedRes?.headers.get("cache-control")).toBe("public, max-age=15, must-revalidate");
    });

    it("enforces API_RATE_LIMITER with profile-prefixed key on public profile reads", async () => {
      let limiterKey = "";
      const env = createTestEnv({
        API_RATE_LIMITER: {
          limit: async ({ key }) => {
            limiterKey = key;
            return { success: false };
          },
        },
      });

      const req = new Request(`${ORIGIN}/api/public/profile/anyuser`);
      const res = await handleUserRequest(req, env);
      expect(limiterKey).toBe("profile:127.0.0.1");
      expect(res?.status).toBe(429);
    });

    it("enforces API_RATE_LIMITER with user-prefixed key on authenticated sync mutations", async () => {
      let limiterKey = "";
      let limitCalls = 0;
      const env = createTestEnv({
        API_RATE_LIMITER: {
          limit: async ({ key }) => {
            limiterKey = key;
            return { success: false };
          },
        },
      });

      const regRes = await handleUserRequest(
        makeJsonRequest("/api/auth/register", "POST", {
          username: "sync_limiter_user",
          password: "password12345",
        }),
        env
      );
      const cookie = extractCookie(regRes!);
      const regJson = (await regRes?.json()) as { user: { id: string } };

      const syncPut = await handleUserRequest(
        makeJsonRequest("/api/user/sync", "PUT", {
          baseRevision: 0,
          state: { bookmarks: [] },
        }, cookie),
        env
      );
      expect(limiterKey).toBe(`user:${regJson.user.id}:sync`);
      expect(syncPut?.status).toBe(429);
    });
  });

  describe("top-level route error boundary", () => {
    it("catches unhandled errors and returns structured 500 JSON with error ID", async () => {
      const errorDb = {
        prepare() {
          throw new Error("Fatal unhandled database failure");
        },
        batch() {
          throw new Error("Fatal unhandled batch failure");
        },
        exec() {
          throw new Error("Fatal unhandled exec failure");
        },
      };

      const env = createTestEnv({ DB: errorDb as typeof env.DB });
      const req = makeJsonRequest("/api/auth/login", "POST", {
        username: "test",
        password: "password12345",
      });

      const res = await handleUserRequest(req, env);
      expect(res?.status).toBe(500);
      expect(res?.headers.get("x-error-id")).not.toBeNull();
      const json = (await res?.json()) as { code: string; error: string };
      expect(json.code).toBe("INTERNAL_SERVER_ERROR");
      expect(json.error).toBe("An internal error occurred");
    });
  });
});
