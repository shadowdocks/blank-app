import {
  DUMMY_PASSWORD_HASH,
  generateId,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./crypto";
import {
  authenticateRequest,
  buildClearSessionCookie,
  buildSessionCookie,
  createSession,
  listUserSessions,
  revokeSession,
} from "./session";
import { getUserState, syncUserState } from "./state";
import {
  AUTH_BODY_LIMIT_BYTES,
  DEFAULT_USER_STATE,
  SESSION_TTL_MS,
  SYNC_BODY_LIMIT_BYTES,
  type MediaBookmark,
  type RateLimiterBinding,
  type SessionRecord,
  type UserEnv,
  type UserRecord,
  type UserStateRecord,
} from "./types";
import {
  normalizeDeviceName,
  readJsonBody,
  sanitizeUserState,
  validatePassword,
  validateSameOrigin,
  validateUsername,
} from "./validation";

const PRIVATE_CACHE_CONTROL = "private, no-store, no-cache, must-revalidate";
const PUBLIC_PROFILE_CACHE_CONTROL = "public, max-age=15, must-revalidate";

function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: HeadersInit = {}
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    headers.set("cache-control", PRIVATE_CACHE_CONTROL);
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function jsonError(
  status: number,
  code: string,
  message: string,
  extraHeaders: HeadersInit = {}
): Response {
  return jsonResponse({ error: message, code }, status, extraHeaders);
}

function getClientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") || "127.0.0.1";
}

async function checkLimiter(
  limiter: RateLimiterBinding | undefined,
  key: string
): Promise<Response | null> {
  if (!limiter) {
    return null;
  }

  try {
    const { success } = await limiter.limit({ key });
    if (!success) {
      return jsonError(429, "RATE_LIMIT_EXCEEDED", "Rate limit exceeded. Please try again later.");
    }
  } catch {
    // If rate limiter fails internally, allow request rather than blocking legitimate traffic
  }

  return null;
}

export async function handleUserRequest(
  request: Request,
  env: UserEnv,
  ctx?: unknown
): Promise<Response | null> {
  try {
    return await dispatchUserRequest(request, env, ctx);
  } catch {
    const errorId = generateId();
    console.error(`[user_backend_error] id=${errorId}`);
    return jsonError(500, "INTERNAL_SERVER_ERROR", "An internal error occurred", {
      "x-error-id": errorId,
    });
  }
}

async function dispatchUserRequest(
  request: Request,
  env: UserEnv,
  _ctx?: unknown
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/~\/\+/, "");
  const method = request.method.toUpperCase();

  // Public Profile route: GET /api/public/profile/:username
  const publicProfileMatch = path.match(/^\/api\/public\/profile\/([A-Za-z0-9_-]+)$/);
  if (publicProfileMatch) {
    if (method !== "GET" && method !== "HEAD") {
      return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
    }
    return handlePublicProfile(request, env, publicProfileMatch[1]);
  }

  // Auth & User routes under /api/
  if (path === "/api/auth/register" && method === "POST") {
    return handleRegister(request, env);
  }

  if (path === "/api/auth/login" && method === "POST") {
    return handleLogin(request, env);
  }

  if (path === "/api/auth/logout" && method === "POST") {
    return handleLogout(request, env);
  }

  if (path === "/api/auth/me" && method === "GET") {
    return handleGetMe(request, env);
  }

  if (path === "/api/auth/sessions" && method === "GET") {
    return handleListSessions(request, env);
  }

  const sessionRevokeMatch = path.match(/^\/api\/auth\/sessions\/([A-Za-z0-9_-]+)$/);
  if (sessionRevokeMatch && method === "DELETE") {
    return handleRevokeSession(request, env, sessionRevokeMatch[1]);
  }

  if (path === "/api/user/sync") {
    if (method === "GET") {
      return handleGetSync(request, env);
    }
    if (method === "PUT" || method === "POST") {
      return handlePutSync(request, env);
    }
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  if (path === "/api/user/profile") {
    if (method === "GET") {
      return handleGetProfile(request, env);
    }
    if (method === "PATCH" || method === "PUT") {
      return handleUpdateProfile(request, env);
    }
    return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  // Not handled by user routes
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRegister(request: Request, env: UserEnv): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const ip = getClientIp(request);
  const rateLimitError = await checkLimiter(env.AUTH_RATE_LIMITER, `auth:register:${ip}`);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody<{
    username?: unknown;
    password?: unknown;
    deviceName?: unknown;
  }>(request, AUTH_BODY_LIMIT_BYTES);

  if (!bodyResult.ok) {
    return jsonError(bodyResult.status ?? 400, bodyResult.code ?? "BAD_REQUEST", bodyResult.message ?? "Bad request");
  }

  const usernameCheck = validateUsername(bodyResult.data?.username);
  if (!usernameCheck.ok) {
    return jsonError(400, "INVALID_USERNAME", usernameCheck.error);
  }

  const passwordCheck = validatePassword(bodyResult.data?.password);
  if (!passwordCheck.ok) {
    return jsonError(400, "INVALID_PASSWORD", passwordCheck.error);
  }

  const username = usernameCheck.value;
  const password = passwordCheck.value;
  const rawDevice = bodyResult.data?.deviceName;

  // Check if username already exists
  const existingUser = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
    .bind(username)
    .first<{ id: string }>();

  if (existingUser) {
    return jsonError(409, "USERNAME_TAKEN", "Username is already taken");
  }

  const now = Date.now();
  const userId = generateId();
  const passwordHash = await hashPassword(password);
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  const sessionId = generateId();
  const deviceName = normalizeDeviceName(rawDevice);
  const expiresAt = now + SESSION_TTL_MS;
  const initialUserState = JSON.stringify(DEFAULT_USER_STATE);

  // Atomically insert user, user_state, and session in one transaction
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, username, password_hash, public_profile, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`
      ).bind(userId, username, passwordHash, now, now),
      env.DB.prepare(
        `INSERT INTO user_state (user_id, revision, state_json, updated_at)
         VALUES (?, 0, ?, ?)`
      ).bind(userId, initialUserState, now),
      env.DB.prepare(
        `INSERT INTO sessions (id, user_id, token_hash, device_name, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(sessionId, userId, tokenHash, deviceName, now, now, expiresAt),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || (err as { code?: string }).code === "SQLITE_CONSTRAINT") {
      return jsonError(409, "USERNAME_TAKEN", "Username is already taken");
    }
    throw err;
  }

  const session: SessionRecord = {
    id: sessionId,
    user_id: userId,
    token_hash: tokenHash,
    device_name: deviceName,
    created_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
  };

  const cookie = buildSessionCookie(token);
  return jsonResponse(
    {
      user: {
        id: userId,
        username,
        publicProfile: false,
        createdAt: now,
      },
      session: {
        id: session.id,
        deviceName: session.device_name,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
      },
    },
    201,
    { "set-cookie": cookie }
  );
}

async function handleLogin(request: Request, env: UserEnv): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const ip = getClientIp(request);
  const rateLimitError = await checkLimiter(env.AUTH_RATE_LIMITER, `auth:login:${ip}`);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody<{
    username?: unknown;
    password?: unknown;
    deviceName?: unknown;
  }>(request, AUTH_BODY_LIMIT_BYTES);

  if (!bodyResult.ok) {
    return jsonError(bodyResult.status ?? 400, bodyResult.code ?? "BAD_REQUEST", bodyResult.message ?? "Bad request");
  }

  const rawUsername = typeof bodyResult.data?.username === "string" ? bodyResult.data.username.trim().toLowerCase() : "";
  const rawPassword = typeof bodyResult.data?.password === "string" ? bodyResult.data.password : "";

  if (!rawUsername || !rawPassword) {
    return jsonError(400, "MISSING_CREDENTIALS", "Username and password are required");
  }

  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, public_profile, created_at, updated_at FROM users WHERE username = ?"
  )
    .bind(rawUsername)
    .first<UserRecord>();

  // Use fixed valid dummy hash when user not found to prevent username enumeration timing attacks
  const hashToVerify = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(rawPassword, hashToVerify);

  if (!user || !valid) {
    return jsonError(401, "INVALID_CREDENTIALS", "Invalid username or password");
  }

  const now = Date.now();
  const rawDevice = bodyResult.data?.deviceName;
  const { session, token } = await createSession(env.DB, user.id, rawDevice, now);

  const cookie = buildSessionCookie(token);
  return jsonResponse(
    {
      user: {
        id: user.id,
        username: user.username,
        publicProfile: user.public_profile === 1,
        createdAt: user.created_at,
      },
      session: {
        id: session.id,
        deviceName: session.device_name,
        createdAt: session.created_at,
        lastSeenAt: session.last_seen_at,
      },
    },
    200,
    { "set-cookie": cookie }
  );
}

async function handleLogout(request: Request, env: UserEnv): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const auth = await authenticateRequest(env.DB, request);
  if (auth) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(auth.session.id).run();
    } catch {
      // ignore deletion errors
    }
  }

  return jsonResponse({ ok: true }, 200, {
    "set-cookie": buildClearSessionCookie(),
  });
}

async function handleGetMe(request: Request, env: UserEnv): Promise<Response> {
  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  return jsonResponse({
    user: {
      id: auth.user.id,
      username: auth.user.username,
      publicProfile: auth.user.public_profile === 1,
      createdAt: auth.user.created_at,
    },
    session: {
      id: auth.session.id,
      deviceName: auth.session.device_name,
      createdAt: auth.session.created_at,
      lastSeenAt: auth.session.last_seen_at,
    },
  });
}

async function handleListSessions(request: Request, env: UserEnv): Promise<Response> {
  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  const sessions = await listUserSessions(env.DB, auth.user.id, auth.session.id);
  return jsonResponse({ sessions });
}

async function handleRevokeSession(
  request: Request,
  env: UserEnv,
  targetSessionId: string
): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  await revokeSession(env.DB, auth.user.id, targetSessionId);

  const extraHeaders: HeadersInit = {};
  if (targetSessionId === auth.session.id) {
    extraHeaders["set-cookie"] = buildClearSessionCookie();
  }

  return jsonResponse({ ok: true }, 200, extraHeaders);
}

async function handleGetSync(request: Request, env: UserEnv): Promise<Response> {
  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  const stateData = await getUserState(env.DB, auth.user.id);
  return jsonResponse({
    revision: stateData.revision,
    state: stateData.state,
  });
}

async function handlePutSync(request: Request, env: UserEnv): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  const rateLimitError = await checkLimiter(env.API_RATE_LIMITER, `user:${auth.user.id}:sync`);
  if (rateLimitError) return rateLimitError;

  const bodyResult = await readJsonBody<{
    baseRevision?: unknown;
    state?: unknown;
  }>(request, SYNC_BODY_LIMIT_BYTES);

  if (!bodyResult.ok) {
    return jsonError(bodyResult.status ?? 400, bodyResult.code ?? "BAD_REQUEST", bodyResult.message ?? "Bad request");
  }

  const baseRevision = bodyResult.data?.baseRevision;
  if (
    typeof baseRevision !== "number" ||
    !Number.isInteger(baseRevision) ||
    baseRevision < 0
  ) {
    return jsonError(400, "INVALID_REVISION", "baseRevision must be a non-negative integer");
  }

  const rawState = bodyResult.data?.state;
  if (!rawState || typeof rawState !== "object") {
    return jsonError(400, "INVALID_STATE", "state must be an object");
  }

  const result = await syncUserState(env.DB, auth.user.id, baseRevision, rawState);
  if (!result.ok) {
    return jsonResponse(
      {
        error: "Conflict: state has been modified by another device or session",
        code: "CONFLICT",
        serverRevision: result.serverRevision,
        serverState: result.serverState,
      },
      409
    );
  }

  return jsonResponse({
    revision: result.revision,
    state: result.state,
  });
}

async function handleGetProfile(request: Request, env: UserEnv): Promise<Response> {
  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  return jsonResponse({
    username: auth.user.username,
    publicProfile: auth.user.public_profile === 1,
  });
}

async function handleUpdateProfile(request: Request, env: UserEnv): Promise<Response> {
  if (!validateSameOrigin(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-origin request rejected");
  }

  const auth = await authenticateRequest(env.DB, request);
  if (!auth) {
    return jsonError(401, "UNAUTHORIZED", "Authentication required");
  }

  const bodyResult = await readJsonBody<{
    publicProfile?: unknown;
  }>(request, AUTH_BODY_LIMIT_BYTES);

  if (!bodyResult.ok) {
    return jsonError(bodyResult.status ?? 400, bodyResult.code ?? "BAD_REQUEST", bodyResult.message ?? "Bad request");
  }

  if (typeof bodyResult.data?.publicProfile !== "boolean") {
    return jsonError(400, "INVALID_PROFILE_SETTING", "publicProfile must be a boolean");
  }

  const publicProfile = bodyResult.data.publicProfile ? 1 : 0;
  const now = Date.now();

  await env.DB.prepare("UPDATE users SET public_profile = ?, updated_at = ? WHERE id = ?")
    .bind(publicProfile, now, auth.user.id)
    .run();

  return jsonResponse({
    username: auth.user.username,
    publicProfile: publicProfile === 1,
  });
}

async function handlePublicProfile(
  request: Request,
  env: UserEnv,
  rawUsername: string
): Promise<Response> {
  const ip = getClientIp(request);
  const rateLimitError = await checkLimiter(env.API_RATE_LIMITER, `profile:${ip}`);
  if (rateLimitError) return rateLimitError;

  const username = rawUsername.trim().toLowerCase();

  const user = await env.DB.prepare(
    "SELECT id, username, public_profile, created_at, updated_at FROM users WHERE username = ?"
  )
    .bind(username)
    .first<UserRecord>();

  if (!user || user.public_profile !== 1) {
    return jsonError(404, "NOT_FOUND", "Profile not found", {
      "cache-control": "private, no-store",
    });
  }

  const stateRow = await env.DB.prepare(
    "SELECT revision, state_json FROM user_state WHERE user_id = ?"
  )
    .bind(user.id)
    .first<UserStateRecord>();

  const revision = stateRow?.revision ?? 0;
  let bookmarks: MediaBookmark[] = [];
  if (stateRow?.state_json) {
    try {
      const parsed = JSON.parse(stateRow.state_json);
      const sanitized = sanitizeUserState(parsed);
      bookmarks = sanitized.bookmarks;
    } catch {
      bookmarks = [];
    }
  }

  // Version/cache key derived from profile updated_at and state revision
  const etag = `W/"u-${user.username}-${user.updated_at}-${revision}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        "cache-control": PUBLIC_PROFILE_CACHE_CONTROL,
      },
    });
  }

  return jsonResponse(
    {
      user: {
        username: user.username,
        createdAt: user.created_at,
      },
      bookmarks,
    },
    200,
    {
      etag,
      "cache-control": PUBLIC_PROFILE_CACHE_CONTROL,
    }
  );
}
