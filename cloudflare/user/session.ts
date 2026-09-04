import { generateId, generateSessionToken, hashSessionToken } from "./crypto";
import {
  SESSION_ROLL_WINDOW_MS,
  SESSION_TTL_MS,
  type AuthUser,
  type D1Database,
  type SessionRecord,
  type UserRecord,
} from "./types";
import { normalizeDeviceName } from "./validation";

export const COOKIE_NAME = "hawk_session";
const TOKEN_HEX_REGEX = /^[a-f0-9]{64}$/i;

export interface AuthContext {
  user: AuthUser;
  session: SessionRecord;
  token: string;
}

export interface UserSessionView {
  id: string;
  deviceName: string;
  createdAt: number;
  lastSeenAt: number;
  isCurrent: boolean;
}

export function parseSessionToken(request: Request): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const trimmed = cookie.trim();
    if (!trimmed.startsWith(`${COOKIE_NAME}=`)) {
      continue;
    }
    const token = trimmed.substring(COOKIE_NAME.length + 1).trim();
    if (TOKEN_HEX_REGEX.test(token)) {
      return token;
    }
  }

  return null;
}

export function buildSessionCookie(token: string): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildClearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

interface JoinedAuthRow {
  session_id: string;
  user_id: string;
  token_hash: string;
  device_name: string;
  session_created_at: number;
  last_seen_at: number;
  expires_at: number;
  username: string;
  public_profile: number;
  user_created_at: number;
  user_updated_at: number;
}

export async function authenticateRequest(
  db: D1Database,
  request: Request,
  now = Date.now()
): Promise<AuthContext | null> {
  const token = parseSessionToken(request);
  if (!token) {
    return null;
  }

  const tokenHash = await hashSessionToken(token);
  const row = await db
    .prepare(
      `SELECT 
        s.id AS session_id,
        s.user_id,
        s.token_hash,
        s.device_name,
        s.created_at AS session_created_at,
        s.last_seen_at,
        s.expires_at,
        u.id AS user_id,
        u.username,
        u.public_profile,
        u.created_at AS user_created_at,
        u.updated_at AS user_updated_at
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token_hash = ?`
    )
    .bind(tokenHash)
    .first<JoinedAuthRow>();

  if (!row) {
    return null;
  }

  if (row.expires_at <= now) {
    // Delete expired session in background
    try {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(row.session_id).run();
    } catch {
      // ignore cleanup errors
    }
    return null;
  }

  const session: SessionRecord = {
    id: row.session_id,
    user_id: row.user_id,
    token_hash: row.token_hash,
    device_name: row.device_name,
    created_at: row.session_created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
  };

  const user: AuthUser = {
    id: row.user_id,
    username: row.username,
    public_profile: row.public_profile,
    created_at: row.user_created_at,
    updated_at: row.user_updated_at,
  };

  // Roll session last_seen at most every 15 minutes during authenticated requests
  await rollSessionLastSeen(db, session, now);

  return { user, session, token };
}

export async function rollSessionLastSeen(
  db: D1Database,
  session: SessionRecord,
  now = Date.now()
): Promise<boolean> {
  if (now - session.last_seen_at < SESSION_ROLL_WINDOW_MS) {
    return false;
  }

  try {
    await db
      .prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?")
      .bind(now, session.id)
      .run();
    session.last_seen_at = now;
    return true;
  } catch {
    return false;
  }
}

export async function createSession(
  db: D1Database,
  userId: string,
  rawDevice: unknown,
  now = Date.now()
): Promise<{ session: SessionRecord; token: string }> {
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const sessionId = generateId();
  const deviceName = normalizeDeviceName(rawDevice);
  const expiresAt = now + SESSION_TTL_MS;

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, device_name, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(sessionId, userId, tokenHash, deviceName, now, now, expiresAt)
    .run();

  const session: SessionRecord = {
    id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    device_name: deviceName,
    created_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
  };

  return { session, token };
}

export async function revokeSession(
  db: D1Database,
  userId: string,
  sessionId: string
): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
    .bind(sessionId, userId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

export async function listUserSessions(
  db: D1Database,
  userId: string,
  currentSessionId: string,
  now = Date.now()
): Promise<UserSessionView[]> {
  const queryResult = await db
    .prepare(
      `SELECT id, device_name, created_at, last_seen_at, expires_at
       FROM sessions
       WHERE user_id = ? AND expires_at > ?
       ORDER BY last_seen_at DESC`
    )
    .bind(userId, now)
    .all<{
      id: string;
      device_name: string;
      created_at: number;
      last_seen_at: number;
      expires_at: number;
    }>();

  const rows = queryResult.results ?? [];
  return rows.map((r) => ({
    id: r.id,
    deviceName: r.device_name,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    isCurrent: r.id === currentSessionId,
  }));
}
