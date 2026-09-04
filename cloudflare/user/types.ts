export interface D1ResultMeta {
  changes?: number;
  last_row_id?: number;
  rows_read?: number;
  rows_written?: number;
  [key: string]: unknown;
}

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  error?: string;
  meta?: D1ResultMeta;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface UserEnv {
  DB: D1Database;
  AUTH_RATE_LIMITER?: RateLimiterBinding;
  API_RATE_LIMITER?: RateLimiterBinding;
}

export interface UserRecord {
  id: string;
  username: string;
  password_hash?: string;
  public_profile: number;
  created_at: number;
  updated_at: number;
}

export type AuthUser = Omit<UserRecord, "password_hash">;

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  device_name: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

export interface UserStateRecord {
  user_id: string;
  revision: number;
  state_json: string;
  updated_at: number;
}

export type MediaType = "movie" | "tv";
export type VideoQuality = "2160p" | "1440p" | "1080p" | "720p" | "480p" | "unknown";

export interface MediaBookmark {
  imdbId: string;
  mediaType: MediaType;
  title: string;
  year: number | null;
  rating: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  bookmarkedAt: string;
}

export interface MediaSummary {
  id: string;
  imdbId?: string | null;
  tmdbId?: number | null;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  endYear?: number | null;
  rating?: number | null;
  voteCount?: number | null;
  genres?: string[];
  posterUrl?: string | null;
  backdropUrl?: string | null;
}

export interface PlaybackRecord {
  media: MediaSummary;
  season: number | null;
  episode: number | null;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
}

export interface PlaybackProgress {
  id: string;
  imdbId: string;
  mediaType: MediaType;
  season: number | null;
  episode: number | null;
  positionSeconds: number;
  durationSeconds: number;
  progressFraction: number;
  completed: boolean;
  updatedAt: string;
}

export interface UserPreferences {
  audioLanguage: string;
  subtitleLanguage: string;
  subtitlesEnabled: boolean;
  autoResume: boolean;
  autoplay: boolean;
  defaultQuality: VideoQuality;
  theme: "dark" | "light" | "system";
}

export interface HawkUserState {
  bookmarks: MediaBookmark[];
  history: PlaybackRecord[];
  progress: Record<string, PlaybackProgress>;
  preferences: UserPreferences;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  audioLanguage: "en",
  subtitleLanguage: "en",
  subtitlesEnabled: false,
  autoResume: true,
  autoplay: true,
  defaultQuality: "1080p",
  theme: "dark",
};

export const DEFAULT_USER_STATE: HawkUserState = {
  bookmarks: [],
  history: [],
  progress: {},
  preferences: DEFAULT_PREFERENCES,
};

export const MAX_BOOKMARKS = 200;
export const MAX_HISTORY = 100;
export const MAX_PROGRESS = 200;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_ROLL_WINDOW_MS = 15 * 60 * 1000; // 15 minutes bounded write
export const AUTH_BODY_LIMIT_BYTES = 16 * 1024; // 16 KB
export const SYNC_BODY_LIMIT_BYTES = 512 * 1024; // 512 KB
