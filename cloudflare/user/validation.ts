import {
  DEFAULT_PREFERENCES,
  DEFAULT_USER_STATE,
  MAX_BOOKMARKS,
  MAX_HISTORY,
  MAX_PROGRESS,
  type HawkUserState,
  type MediaBookmark,
  type MediaSummary,
  type MediaType,
  type PlaybackProgress,
  type PlaybackRecord,
  type UserPreferences,
  type VideoQuality,
} from "./types";

export const RESERVED_USERNAMES = new Set([
  "about",
  "account",
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "bookmarks",
  "catalog",
  "dashboard",
  "downloads",
  "explore",
  "favorites",
  "health",
  "history",
  "help",
  "library",
  "login",
  "logout",
  "manifest",
  "me",
  "media",
  "null",
  "offline",
  "player",
  "privacy",
  "profile",
  "proxy",
  "public",
  "register",
  "root",
  "search",
  "session",
  "sessions",
  "settings",
  "static",
  "status",
  "stream",
  "support",
  "sw",
  "sync",
  "terms",
  "title",
  "torrents",
  "u",
  "undefined",
  "user",
  "users",
  "watch",
]);

const USERNAME_REGEX = /^[a-z0-9_-]{3,24}$/;

export function validateUsername(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Username must be a string" };
  }

  const normalized = raw.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 24) {
    return { ok: false, error: "Username must be between 3 and 24 characters" };
  }

  if (!USERNAME_REGEX.test(normalized)) {
    return {
      ok: false,
      error: "Username may only contain lowercase letters, numbers, underscores, and hyphens",
    };
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    return { ok: false, error: "Username is reserved" };
  }

  return { ok: true, value: normalized };
}

export function validatePassword(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Password must be a string" };
  }

  if (raw.length < 10 || raw.length > 128) {
    return { ok: false, error: "Password must be between 10 and 128 characters" };
  }

  return { ok: true, value: raw };
}

export function normalizeDeviceName(raw: unknown): string {
  if (typeof raw !== "string") {
    return "Unknown Device";
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return "Unknown Device";
  }
  return trimmed.slice(0, 64);
}

export function validateSameOrigin(request: Request): boolean {
  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  const originHeader = request.headers.get("origin");
  if (originHeader) {
    return originHeader === requestOrigin;
  }

  const refererHeader = request.headers.get("referer");
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin === requestOrigin;
    } catch {
      return false;
    }
  }

  return false;
}

export interface BodyReadResult<T> {
  ok: boolean;
  data?: T;
  status?: number;
  code?: string;
  message?: string;
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes: number
): Promise<BodyReadResult<T>> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json",
    };
  }

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declaredLength = parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return {
        ok: false,
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: `Payload exceeds maximum allowed size of ${maxBytes} bytes`,
      };
    }
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await request.arrayBuffer();
  } catch {
    return {
      ok: false,
      status: 400,
      code: "READ_ERROR",
      message: "Failed to read request body",
    };
  }

  if (buffer.byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: `Payload exceeds maximum allowed size of ${maxBytes} bytes`,
    };
  }

  if (buffer.byteLength === 0) {
    return {
      ok: false,
      status: 400,
      code: "EMPTY_BODY",
      message: "Request body cannot be empty",
    };
  }

  try {
    const text = new TextDecoder().decode(buffer);
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 400,
      code: "INVALID_JSON",
      message: "Request body contains invalid JSON",
    };
  }
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function asString(val: unknown, maxLen = 256): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed ? trimmed.slice(0, maxLen) : null;
}

function asNumber(val: unknown): number | null {
  return typeof val === "number" && Number.isFinite(val) ? val : null;
}

function sanitizeBookmark(item: unknown): MediaBookmark | null {
  const obj = asRecord(item);
  if (!obj) return null;

  const imdbId = asString(obj.imdbId, 64) || asString(obj.id, 64);
  const title = asString(obj.title, 256);
  if (!imdbId || !title) return null;

  const mediaType: MediaType = obj.mediaType === "tv" ? "tv" : "movie";
  const genres = Array.isArray(obj.genres)
    ? obj.genres
        .map((g) => asString(g, 64))
        .filter((g): g is string => g !== null)
        .slice(0, 20)
    : [];

  return {
    imdbId,
    mediaType,
    title,
    year: asNumber(obj.year),
    rating: asNumber(obj.rating),
    posterUrl: asString(obj.posterUrl, 2048),
    backdropUrl: asString(obj.backdropUrl, 2048),
    genres,
    bookmarkedAt: asString(obj.bookmarkedAt, 64) ?? new Date().toISOString(),
  };
}

function sanitizeMediaSummary(item: unknown): MediaSummary | null {
  const obj = asRecord(item);
  if (!obj) return null;

  const id = asString(obj.id, 64) || asString(obj.imdbId, 64);
  const title = asString(obj.title, 256);
  if (!id || !title) return null;

  const mediaType: MediaType = obj.mediaType === "tv" ? "tv" : "movie";
  const genres = Array.isArray(obj.genres)
    ? obj.genres
        .map((g) => asString(g, 64))
        .filter((g): g is string => g !== null)
        .slice(0, 20)
    : [];

  return {
    id,
    imdbId: asString(obj.imdbId, 64) ?? (id.startsWith("tt") ? id : null),
    tmdbId: asNumber(obj.tmdbId),
    mediaType,
    title,
    originalTitle: asString(obj.originalTitle, 256),
    year: asNumber(obj.year),
    endYear: asNumber(obj.endYear),
    rating: asNumber(obj.rating),
    voteCount: asNumber(obj.voteCount),
    genres,
    posterUrl: asString(obj.posterUrl, 2048),
    backdropUrl: asString(obj.backdropUrl, 2048),
  };
}

function sanitizeHistory(item: unknown): PlaybackRecord | null {
  const obj = asRecord(item);
  if (!obj) return null;

  const media = sanitizeMediaSummary(obj.media);
  if (!media) return null;

  const positionSeconds = Math.max(0, asNumber(obj.positionSeconds) ?? 0);
  const durationSeconds = Math.max(0, asNumber(obj.durationSeconds) ?? 0);

  return {
    media,
    season: asNumber(obj.season),
    episode: asNumber(obj.episode),
    positionSeconds,
    durationSeconds,
    updatedAt: asString(obj.updatedAt, 64) ?? new Date().toISOString(),
  };
}

function sanitizeProgress(item: unknown): PlaybackProgress | null {
  const obj = asRecord(item);
  if (!obj) return null;

  const imdbId = asString(obj.imdbId, 64) || asString(obj.id, 64);
  if (!imdbId) return null;

  const season = asNumber(obj.season);
  const episode = asNumber(obj.episode);
  const positionSeconds = Math.max(0, asNumber(obj.positionSeconds) ?? 0);
  const durationSeconds = Math.max(0, asNumber(obj.durationSeconds) ?? 0);
  const progressFraction = durationSeconds > 0 ? positionSeconds / durationSeconds : 0;
  const id =
    asString(obj.id, 128) ??
    (season !== null && episode !== null ? `${imdbId}:s${season}:e${episode}` : imdbId);

  return {
    id,
    imdbId,
    mediaType: obj.mediaType === "tv" ? "tv" : "movie",
    season,
    episode,
    positionSeconds,
    durationSeconds,
    progressFraction: Math.max(0, Math.min(1, progressFraction)),
    completed: Boolean(obj.completed) || progressFraction >= 0.9,
    updatedAt: asString(obj.updatedAt, 64) ?? new Date().toISOString(),
  };
}

const VALID_QUALITIES = new Set<string>([
  "2160p",
  "1440p",
  "1080p",
  "720p",
  "480p",
  "unknown",
]);

const VALID_THEMES = new Set<string>(["dark", "light", "system"]);

export function sanitizePreferences(raw: unknown): UserPreferences {
  const obj = asRecord(raw) ?? {};
  const quality = String(obj.defaultQuality ?? "");
  const theme = String(obj.theme ?? "");

  return {
    audioLanguage: asString(obj.audioLanguage, 16) ?? DEFAULT_PREFERENCES.audioLanguage,
    subtitleLanguage: asString(obj.subtitleLanguage, 16) ?? DEFAULT_PREFERENCES.subtitleLanguage,
    subtitlesEnabled:
      typeof obj.subtitlesEnabled === "boolean"
        ? obj.subtitlesEnabled
        : DEFAULT_PREFERENCES.subtitlesEnabled,
    autoResume:
      typeof obj.autoResume === "boolean"
        ? obj.autoResume
        : DEFAULT_PREFERENCES.autoResume,
    autoplay:
      typeof obj.autoplay === "boolean"
        ? obj.autoplay
        : DEFAULT_PREFERENCES.autoplay,
    defaultQuality: VALID_QUALITIES.has(quality)
      ? (quality as VideoQuality)
      : DEFAULT_PREFERENCES.defaultQuality,
    theme: VALID_THEMES.has(theme)
      ? (theme as "dark" | "light" | "system")
      : DEFAULT_PREFERENCES.theme,
  };
}

export function sanitizeUserState(raw: unknown): HawkUserState {
  const obj = asRecord(raw) ?? {};

  const bookmarks: MediaBookmark[] = [];
  if (Array.isArray(obj.bookmarks)) {
    for (const item of obj.bookmarks) {
      const sanitized = sanitizeBookmark(item);
      if (sanitized) {
        bookmarks.push(sanitized);
        if (bookmarks.length >= MAX_BOOKMARKS) break;
      }
    }
  }

  const history: PlaybackRecord[] = [];
  if (Array.isArray(obj.history)) {
    for (const item of obj.history) {
      const sanitized = sanitizeHistory(item);
      if (sanitized) {
        history.push(sanitized);
        if (history.length >= MAX_HISTORY) break;
      }
    }
  }

  const progress: Record<string, PlaybackProgress> = Object.create(null);
  const rawProgress = asRecord(obj.progress);
  if (rawProgress) {
    let count = 0;
    for (const [key, value] of Object.entries(rawProgress)) {
      if (count >= MAX_PROGRESS) break;
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      const sanitized = sanitizeProgress(value);
      if (sanitized) {
        if (
          sanitized.id === "__proto__" ||
          sanitized.id === "constructor" ||
          sanitized.id === "prototype"
        ) {
          continue;
        }
        const safeKey = asString(key, 128) ?? sanitized.id;
        if (
          safeKey === "__proto__" ||
          safeKey === "constructor" ||
          safeKey === "prototype"
        ) {
          continue;
        }
        progress[safeKey] = sanitized;
        count++;
      }
    }
  }

  const preferences = sanitizePreferences(obj.preferences);

  return {
    bookmarks,
    history,
    progress,
    preferences,
  };
}
