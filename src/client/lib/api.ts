import { mountPath } from "@/lib/router"
import type {
  AccountSession,
  AuthResponse,
  HawkSyncedState,
  LoginInput,
  PublicUserProfile,
  RegisterInput,
  SyncSuccessResponse,
  UserProfileResponse,
} from "./account-types"
import type {
  CatalogHome,
  CatalogPage,
  EpisodePage,
  MediaDetails,
  MediaSummary,
  MediaType,
} from "../../shared/media"
import type {
  ClientCapabilities,
  MediaTarget,
  PlaybackSource,
  PlaybackStatus,
  SubtitleTrack,
} from "../../shared/playback"

/**
 * Normalized API Client for Hawk.
 *
 * All paths are resolved relative to the current mount (root, arbitrary mount,
 * or Streamlit /~/+/). GET requests are safely deduplicated in-flight.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, status: number, details?: unknown, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.details = details
    this.code = code
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "Something went wrong."
}

export function isAbort(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true
  if (error instanceof Error && error.name === "AbortError") return true
  return false
}

export function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError")
}

function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? abortError())
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort)
      reject(signal.reason ?? abortError())
    }
    signal.addEventListener("abort", onAbort)
    promise.then(
      (val) => {
        signal.removeEventListener("abort", onAbort)
        resolve(val)
      },
      (err) => {
        signal.removeEventListener("abort", onAbort)
        reject(err)
      }
    )
  })
}

const inFlightGets = new Map<string, Promise<unknown>>()

export function clearInFlightRequests(): void {
  inFlightGets.clear()
}

export const clearDeduplicationCache = clearInFlightRequests

export function inFlightRequestCount(): number {
  return inFlightGets.size
}

async function executeRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      credentials: "same-origin",
      ...init,
    })
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError("Network unreachable. Check your connection and retry.", 0)
  }

  const raw = await response.text()
  let data: unknown = null
  if (raw && raw.trim().length > 0) {
    try {
      data = JSON.parse(raw) as unknown
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status}).`
    let code: string | undefined
    let details: unknown

    if (data && typeof data === "object") {
      const obj = data as Record<string, unknown>
      if (typeof obj.error === "string" && obj.error.trim()) {
        detail = obj.error
      } else if (typeof obj.message === "string" && obj.message.trim()) {
        detail = obj.message
      } else if (typeof obj.detail === "string" && obj.detail.trim()) {
        detail = obj.detail
      }
      if (typeof obj.code === "string") code = obj.code
      details = obj.details ?? data
    } else if (raw && raw.length < 200 && !raw.includes("<html")) {
      detail = raw.trim()
    } else if (response.status === 404) {
      detail = "The requested item was not found."
    } else if (response.status >= 500) {
      detail = "A server error occurred. Please try again later."
    }

    throw new ApiError(detail, response.status, details, code)
  }

  if (response.status === 204 || !raw.trim()) {
    return null as T
  }

  if (data === null) {
    throw new ApiError("Unexpected non-JSON response from the server.", response.status)
  }

  return data as T
}

export interface RequestOptions extends RequestInit {
  dedupe?: boolean
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const url = mountPath(path)
  const isGet = !init?.method || init.method.toUpperCase() === "GET"
  const canDedupe = isGet && init?.dedupe !== false && init?.cache !== "no-store"

  if (canDedupe) {
    if (init?.signal?.aborted) return Promise.reject(init.signal.reason ?? abortError())
    let pending = inFlightGets.get(url) as Promise<T> | undefined
    if (!pending) {
      const { signal: _callerSignal, ...sharedInit } = init ?? {}
      pending = executeRequest<T>(url, sharedInit).finally(() => {
        inFlightGets.delete(url)
      })
      // Prevent unhandled promise rejection if callers abort or disconnect
      pending.catch(() => {})
      inFlightGets.set(url, pending as Promise<unknown>)
    }
    return raceWithSignal(pending, init?.signal)
  }

  return executeRequest<T>(url, init)
}

/* -------------------------------------------------------------------------- */
/* Normalized API Methods & Parameters                                        */
/* -------------------------------------------------------------------------- */

export interface CatalogSearchParams {
  query: string
  type?: MediaType
  cursor?: string
  limit?: number
}

export interface CatalogDiscoverParams {
  genre?: string
  type?: MediaType
  sort?: string
  cursor?: string
  limit?: number
}

export interface SourceOptions {
  season?: number
  episode?: number
}

export type PlaybackCreateInput = {
  target?: MediaTarget | (Partial<MediaTarget> & { imdbId: string; mediaType: MediaType })
  imdbId?: string
  mediaType?: MediaType
  title?: string
  year?: number | null
  season?: number | null
  episode?: number | null
  episodeTitle?: string | null
  sourceId?: string
  source?: PlaybackSource | { name?: string; magnet: string; quality?: string; seeds?: number; sizeBytes?: number }
  magnet?: string
  fileIndex?: number | null
}

export async function fetchCatalogHome(signal?: AbortSignal): Promise<CatalogHome> {
  return request<CatalogHome>("api/catalog/home", { signal })
}

export async function searchCatalog(
  params: CatalogSearchParams,
  signal?: AbortSignal
): Promise<CatalogPage<MediaSummary>> {
  const query = new URLSearchParams()
  query.set("q", params.query)
  if (params.type) query.set("type", params.type)
  if (params.cursor) query.set("cursor", params.cursor)
  if (params.limit !== undefined) query.set("limit", String(params.limit))
  return request<CatalogPage<MediaSummary>>(`api/catalog/search?${query}`, { signal })
}

export async function discoverCatalog(
  params?: CatalogDiscoverParams,
  signal?: AbortSignal
): Promise<CatalogPage<MediaSummary>> {
  const query = new URLSearchParams()
  if (params?.genre) query.set("genre", params.genre)
  if (params?.type) query.set("type", params.type)
  if (params?.sort) query.set("sort", params.sort)
  if (params?.cursor) query.set("cursor", params.cursor)
  if (params?.limit !== undefined) query.set("limit", String(params.limit))
  const qs = query.toString()
  return request<CatalogPage<MediaSummary>>(`api/catalog/discover${qs ? `?${qs}` : ""}`, { signal })
}

export async function fetchCatalogTitle(
  imdbId: string,
  signal?: AbortSignal
): Promise<MediaDetails> {
  return request<MediaDetails>(`api/catalog/title/${encodeURIComponent(imdbId)}`, { signal })
}

export async function fetchCatalogEpisodes(
  imdbId: string,
  season: number,
  signal?: AbortSignal
): Promise<EpisodePage> {
  return request<EpisodePage>(
    `api/catalog/episodes/${encodeURIComponent(imdbId)}/${encodeURIComponent(String(season))}`,
    { signal }
  )
}

export function fetchPlaybackSources(target: MediaTarget, signal?: AbortSignal, capabilities?: ClientCapabilities): Promise<PlaybackSource[]>
export function fetchPlaybackSources(imdbId: string, options?: SourceOptions, signal?: AbortSignal): Promise<PlaybackSource[]>
export async function fetchPlaybackSources(
  targetOrId: MediaTarget | string,
  optionsOrSignal?: SourceOptions | AbortSignal,
  signalOrCapabilities?: AbortSignal | ClientCapabilities
): Promise<PlaybackSource[]> {
  const target: MediaTarget = typeof targetOrId === "string"
    ? {
        imdbId: targetOrId,
        mediaType: optionsOrSignal && "season" in optionsOrSignal ? "tv" : "movie",
        title: targetOrId,
        year: null,
        season: optionsOrSignal && "season" in optionsOrSignal ? optionsOrSignal.season ?? null : null,
        episode: optionsOrSignal && "episode" in optionsOrSignal ? optionsOrSignal.episode ?? null : null,
        episodeTitle: null,
      }
    : targetOrId
  const signal = typeof targetOrId === "string" ? signalOrCapabilities as AbortSignal | undefined : optionsOrSignal as AbortSignal | undefined
  const capabilities = typeof targetOrId === "string" ? undefined : signalOrCapabilities as ClientCapabilities | undefined
  const query = new URLSearchParams()
  query.set("imdbId", target.imdbId)
  query.set("mediaType", target.mediaType)
  query.set("title", target.title)
  if (target.year !== null) query.set("year", String(target.year))
  if (target.season !== null) query.set("season", String(target.season))
  if (target.episode !== null) query.set("episode", String(target.episode))
  if (target.episodeTitle) query.set("episodeTitle", target.episodeTitle)
  if (capabilities?.supportedAudioCodecs?.length) query.set("supportedAudioCodecs", capabilities.supportedAudioCodecs.join(","))
  if (capabilities?.unsupportedAudioCodecs?.length) query.set("unsupportedAudioCodecs", capabilities.unsupportedAudioCodecs.join(","))
  const data = await request<{ results: PlaybackSource[] } | PlaybackSource[]>(`api/sources?${query}`, { signal })
  return Array.isArray(data) ? data : data.results
}

export async function createPlayback(
  input: PlaybackCreateInput | MediaTarget,
  signal?: AbortSignal
): Promise<PlaybackStatus> {
  let payload: PlaybackCreateInput | MediaTarget = input
  const configuredSource = "source" in input ? input.source : undefined
  const configuredMagnet = "magnet" in input ? input.magnet : undefined
  if (!configuredSource && !configuredMagnet) {
    const candidate = "target" in input && input.target ? input.target : input
    if (
      typeof candidate.imdbId === "string" && candidate.imdbId &&
      (candidate.mediaType === "movie" || candidate.mediaType === "tv") &&
      typeof candidate.title === "string" && candidate.title
    ) {
      const target: MediaTarget = {
        imdbId: candidate.imdbId,
        mediaType: candidate.mediaType,
        title: candidate.title,
        year: candidate.year ?? null,
        season: candidate.season ?? null,
        episode: candidate.episode ?? null,
        episodeTitle: candidate.episodeTitle ?? null,
      }
      const [source] = await fetchPlaybackSources(target, signal)
      if (!source) throw new ApiError("No playable sources found.", 404)
      payload = { ...(input as PlaybackCreateInput), target, source }
    }
  }
  return request<PlaybackStatus>("api/playback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  })
}

export async function fetchPlaybackStatus(
  playbackId: string,
  signal?: AbortSignal
): Promise<PlaybackStatus> {
  return request<PlaybackStatus>(`api/playback/${encodeURIComponent(playbackId)}`, { signal })
}

export async function deletePlayback(
  playbackId: string,
  signal?: AbortSignal
): Promise<void> {
  await request<unknown>(`api/playback/${encodeURIComponent(playbackId)}`, {
    method: "DELETE",
    signal,
  })
}

export async function fetchSubtitles(
  playbackId: string,
  signal?: AbortSignal
): Promise<SubtitleTrack[]> {
  return request<SubtitleTrack[]>(`api/playback/${encodeURIComponent(playbackId)}/subtitles`, {
    signal,
  })
}

export function streamUrl(playbackIdOrInfoHash: string, fileIndex?: number | null): string {
  const segment = encodeURIComponent(playbackIdOrInfoHash)
  if (fileIndex !== undefined && fileIndex !== null) {
    return mountPath(`api/stream/${segment}/${encodeURIComponent(String(fileIndex))}`)
  }
  return mountPath(`api/stream/${segment}`)
}

/* -------------------------------------------------------------------------- */
/* Account, Authentication & Sync API Methods                                  */
/* -------------------------------------------------------------------------- */

export async function register(
  input: RegisterInput,
  signal?: AbortSignal
): Promise<AuthResponse> {
  clearInFlightRequests()
  return request<AuthResponse>("api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
}

export async function login(
  input: LoginInput,
  signal?: AbortSignal
): Promise<AuthResponse> {
  clearInFlightRequests()
  return request<AuthResponse>("api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  })
}

export async function logout(signal?: AbortSignal): Promise<{ ok: boolean }> {
  clearInFlightRequests()
  return request<{ ok: boolean }>("api/auth/logout", {
    method: "POST",
    signal,
  })
}

export async function getMe(signal?: AbortSignal): Promise<AuthResponse> {
  return request<AuthResponse>("api/auth/me", {
    signal,
    cache: "no-store",
    dedupe: false,
  })
}

export async function getSessions(signal?: AbortSignal): Promise<AccountSession[]> {
  const result = await request<{ sessions: AccountSession[] }>("api/auth/sessions", {
    signal,
    cache: "no-store",
    dedupe: false,
  })
  return result.sessions
}

export async function revokeSession(
  sessionId: string,
  signal?: AbortSignal
): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`api/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    signal,
  })
}

export async function getSync(signal?: AbortSignal): Promise<SyncSuccessResponse> {
  return request<SyncSuccessResponse>("api/user/sync", {
    signal,
    cache: "no-store",
    dedupe: false,
  })
}

export const getSyncState = getSync

export async function putSync(
  baseRevision: number,
  state: HawkSyncedState,
  signal?: AbortSignal
): Promise<SyncSuccessResponse> {
  return request<SyncSuccessResponse>("api/user/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseRevision, state }),
    signal,
  })
}

export const putSyncState = putSync

export async function getUserProfile(signal?: AbortSignal): Promise<UserProfileResponse> {
  return request<UserProfileResponse>("api/user/profile", {
    signal,
    cache: "no-store",
    dedupe: false,
  })
}

export async function updateUserProfile(
  patch: { publicProfile: boolean },
  signal?: AbortSignal
): Promise<UserProfileResponse> {
  return request<UserProfileResponse>("api/user/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    signal,
  })
}

export async function getPublicProfile(
  username: string,
  signal?: AbortSignal
): Promise<PublicUserProfile> {
  return request<PublicUserProfile>(`api/public/profile/${encodeURIComponent(username)}`, {
    signal,
  })
}

export function isSyncConflict(error: unknown): error is ApiError & {
  details: {
    error: string
    code: "CONFLICT"
    serverRevision: number
    serverState: HawkSyncedState
  }
} {
  if (error instanceof ApiError && error.status === 409) {
    const details = error.details as any
    return (
      details &&
      typeof details === "object" &&
      typeof details.serverRevision === "number" &&
      details.serverState &&
      typeof details.serverState === "object"
    )
  }
  return false
}

export const apiClient = {
  auth: {
    register,
    login,
    logout,
    me: getMe,
    sessions: getSessions,
    revokeSession,
  },
  sync: {
    get: getSync,
    put: putSync,
  },
  user: {
    getProfile: getUserProfile,
    updateProfile: updateUserProfile,
  },
  profile: {
    get: getPublicProfile,
  },
  catalog: {
    home: fetchCatalogHome,
    search: searchCatalog,
    discover: discoverCatalog,
    title: fetchCatalogTitle,
    episodes: fetchCatalogEpisodes,
  },
  sources: fetchPlaybackSources,
  playback: {
    create: createPlayback,
    status: fetchPlaybackStatus,
    delete: deletePlayback,
    subtitles: fetchSubtitles,
    streamUrl,
  },
  streamUrl,
}
