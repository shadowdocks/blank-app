import { describe, expect, it } from "bun:test";
import { generateId, hashPassword, hashSessionToken } from "../crypto";
import {
  authenticateRequest,
  buildClearSessionCookie,
  buildSessionCookie,
  COOKIE_NAME,
  createSession,
  listUserSessions,
  parseSessionToken,
  revokeSession,
  rollSessionLastSeen,
} from "../session";
import { createMockD1 } from "./d1-mock";

describe("session", () => {
  describe("cookie utilities", () => {
    it("parses valid session cookie", () => {
      const token = "a".repeat(64);
      const req = new Request("https://hawk.local/", {
        headers: { cookie: `other=123; ${COOKIE_NAME}=${token}; foo=bar` },
      });

      const parsed = parseSessionToken(req);
      expect(parsed).toBe(token);
    });

    it("returns null for missing or invalid token cookie", () => {
      const req1 = new Request("https://hawk.local/");
      expect(parseSessionToken(req1)).toBeNull();

      const req2 = new Request("https://hawk.local/", {
        headers: { cookie: `${COOKIE_NAME}=not-a-hex-token` },
      });
      expect(parseSessionToken(req2)).toBeNull();
    });

    it("builds correct session cookie string", () => {
      const token = "b".repeat(64);
      const cookie = buildSessionCookie(token);
      expect(cookie).toContain(`${COOKIE_NAME}=${token}`);
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Max-Age=2592000"); // 30 days
    });

    it("builds clear session cookie", () => {
      const clear = buildClearSessionCookie();
      expect(clear).toContain(`${COOKIE_NAME}=;`);
      expect(clear).toContain("Max-Age=0");
    });
  });

  describe("database session management", () => {
    async function seedUser(db = createMockD1()) {
      const userId = generateId();
      const now = Date.now();
      const hash = await hashPassword("password12345");
      await db
        .prepare(
          "INSERT INTO users (id, username, password_hash, public_profile, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)"
        )
        .bind(userId, "testuser", hash, now, now)
        .run();
      return { db, userId, now };
    }

    it("creates session and stores only SHA-256 hash in DB", async () => {
      const { db, userId } = await seedUser();
      const { session, token } = await createSession(db, userId, "MacBook");

      expect(token.length).toBe(64);
      expect(session.user_id).toBe(userId);
      expect(session.device_name).toBe("MacBook");

      // Verify DB stores hash, not raw token
      const row = await db
        .prepare("SELECT token_hash FROM sessions WHERE id = ?")
        .bind(session.id)
        .first<{ token_hash: string }>();

      expect(row).not.toBeNull();
      expect(row!.token_hash).not.toBe(token);
      expect(row!.token_hash).toBe(await hashSessionToken(token));
    });

    it("authenticates valid request with cookie", async () => {
      const { db, userId } = await seedUser();
      const { token } = await createSession(db, userId, "iPhone");

      const req = new Request("https://hawk.local/api/auth/me", {
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      });

      const auth = await authenticateRequest(db, req);
      expect(auth).not.toBeNull();
      expect(auth!.user.id).toBe(userId);
      expect(auth!.user.username).toBe("testuser");
      expect(auth!.session.device_name).toBe("iPhone");
      expect(auth!.token).toBe(token);
      // Ensure password_hash is not selected or retained on AuthUser
      expect((auth!.user as Record<string, unknown>).password_hash).toBe(undefined);
    });

    it("automatically rolls last_seen during ordinary authenticateRequest calls if > 15 minutes elapsed", async () => {
      const { db, userId } = await seedUser();
      const t0 = 1_000_000_000;
      const { token, session } = await createSession(db, userId, "iPad", t0);

      const req = new Request("https://hawk.local/api/user/sync", {
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      });

      // 16 minutes later
      const auth = await authenticateRequest(db, req, t0 + 16 * 60 * 1000);
      expect(auth).not.toBeNull();
      expect(auth!.session.last_seen_at).toBe(t0 + 16 * 60 * 1000);

      const row = await db
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .bind(session.id)
        .first<{ last_seen_at: number }>();
      expect(row?.last_seen_at).toBe(t0 + 16 * 60 * 1000);
    });

    it("rejects expired sessions and cleans them up", async () => {
      const { db, userId } = await seedUser();
      const now = Date.now();
      const { token, session } = await createSession(db, userId, "Old Device", now - 1000);

      // Force expires_at into the past
      await db
        .prepare("UPDATE sessions SET expires_at = ? WHERE id = ?")
        .bind(now - 100, session.id)
        .run();

      const req = new Request("https://hawk.local/api/auth/me", {
        headers: { cookie: `${COOKIE_NAME}=${token}` },
      });

      const auth = await authenticateRequest(db, req, now);
      expect(auth).toBeNull();

      // Verify expired session was removed
      const row = await db
        .prepare("SELECT id FROM sessions WHERE id = ?")
        .bind(session.id)
        .first();
      expect(row).toBeNull();
    });

    it("rolls last_seen with bounded frequency (> 15 minutes)", async () => {
      const { db, userId } = await seedUser();
      const t0 = 1_000_000_000;
      const { session } = await createSession(db, userId, "Device", t0);

      // 5 minutes later: within window, should NOT write to DB
      const rolledEarly = await rollSessionLastSeen(db, session, t0 + 5 * 60 * 1000);
      expect(rolledEarly).toBe(false);

      // 16 minutes later: outside window, should update DB
      const rolledLate = await rollSessionLastSeen(db, session, t0 + 16 * 60 * 1000);
      expect(rolledLate).toBe(true);

      const updatedRow = await db
        .prepare("SELECT last_seen_at FROM sessions WHERE id = ?")
        .bind(session.id)
        .first<{ last_seen_at: number }>();
      expect(updatedRow!.last_seen_at).toBe(t0 + 16 * 60 * 1000);
    });

    it("lists sessions and revokes owner session", async () => {
      const { db, userId } = await seedUser();
      const s1 = await createSession(db, userId, "Laptop");
      const s2 = await createSession(db, userId, "Tablet");

      const sessions = await listUserSessions(db, userId, s1.session.id);
      expect(sessions.length).toBe(2);

      const current = sessions.find((s) => s.id === s1.session.id);
      expect(current?.isCurrent).toBe(true);

      const other = sessions.find((s) => s.id === s2.session.id);
      expect(other?.isCurrent).toBe(false);

      // Revoke s2
      const revoked = await revokeSession(db, userId, s2.session.id);
      expect(revoked).toBe(true);

      const remaining = await listUserSessions(db, userId, s1.session.id);
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe(s1.session.id);
    });
  });
});
