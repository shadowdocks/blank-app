import { mountPath } from "@/lib/router"
import type { MediaType, Source, SubtitleTrack, TimeBucket, Title, TorrentStatus } from "@/lib/types"

/**
 * Every path here is mount-relative on purpose. Streamlit serves this app from
 * a nested mount, so a root-absolute "/api/..." would escape it and 404. The
 * paths are joined onto the mount rather than left relative to the document,
 * because a deep route like /app/movie/603 would otherwise resolve them wrong.
 */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return "Something went wrong."
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(mountPath(path), init)
  } catch (error) {
    if (isAbort(error)) throw error
    throw new ApiError("Network unreachable. Check your connection and retry.", 0)
  }

  const raw = await response.text()
  let data: unknown = null
  if (raw) {
    try {
      data = JSON.parse(raw) as unknown
    } catch {
      data = null
    }
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status}).`
    throw new ApiError(detail, response.status)
  }

  if (data === null) throw new ApiError("Unexpected response from the server.", response.status)
  return data as T
}

/** The server reports whole seconds as `elapsed`; the UI works in milliseconds. */
type RawStatus = Omit<TorrentStatus, "elapsedMs"> & { elapsedMs?: number; elapsed?: number }

function toStatus(raw: RawStatus): TorrentStatus {
  const elapsedMs = Number.isFinite(raw.elapsedMs)
    ? Number(raw.elapsedMs)
    : (Number(raw.elapsed) || 0) * 1000
  return {
    infoHash: String(raw.infoHash ?? ""),
    name: raw.name || "Resolving metadata",
    progress: Number(raw.progress) || 0,
    downloaded: Number(raw.downloaded) || 0,
    length: Number(raw.length) || 0,
    numPeers: Number(raw.numPeers) || 0,
    downloadSpeed: Number(raw.downloadSpeed) || 0,
    done: Boolean(raw.done),
    video: typeof raw.video === "number" ? raw.video : null,
    metadata: Boolean(raw.metadata),
    elapsedMs,
    lastEvent: raw.lastEvent || "connecting",
    subtitles: Array.isArray(raw.subtitles)
      ? raw.subtitles.filter(
          (track): track is SubtitleTrack =>
            Boolean(track) &&
            typeof track === "object" &&
            typeof track.index === "number" &&
            typeof track.name === "string",
        )
      : [],
  }
}

function usable(results: unknown): Title[] {
  return Array.isArray(results) ? (results as Title[]).filter((item) => item && item.title) : []
}

export async function fetchRecommendations(
  params: { mood: string; type: MediaType; time: TimeBucket },
  signal?: AbortSignal,
): Promise<Title[]> {
  const query = new URLSearchParams({ mood: params.mood, type: params.type, time: params.time })
  const data = await request<{ results?: Title[] }>(`api/recommend?${query}`, { signal })
  return usable(data.results)
}

/** Hydrates a title from its route alone, so a shared link opens anywhere. */
export async function fetchTitle(
  type: MediaType,
  id: string,
  signal?: AbortSignal,
): Promise<Title> {
  const query = new URLSearchParams({ type, id })
  const data = await request<{ result?: Title }>(`api/title?${query}`, { signal })
  const result = data.result
  if (!result || !result.title) throw new ApiError("That title could not be found.", 404)
  return result
}

export async function searchTitles(query: string, signal?: AbortSignal): Promise<Title[]> {
  const params = new URLSearchParams({ q: query })
  const data = await request<{ results?: Title[] }>(`api/search?${params}`, { signal })
  return usable(data.results)
}

export async function fetchSources(title: string, signal?: AbortSignal): Promise<Source[]> {
  const query = new URLSearchParams({ title })
  const data = await request<{ results?: Source[] }>(`api/sources?${query}`, { signal })
  return Array.isArray(data.results) ? data.results.filter((item) => item && item.magnet) : []
}

export async function startTorrent(magnet: string, signal?: AbortSignal): Promise<TorrentStatus> {
  const raw = await request<RawStatus>("api/torrents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ magnet }),
    signal,
  })
  return toStatus(raw)
}

export async function fetchTorrent(infoHash: string, signal?: AbortSignal): Promise<TorrentStatus> {
  const raw = await request<RawStatus>(`api/torrents/${encodeURIComponent(infoHash)}`, { signal })
  return toStatus(raw)
}

export function streamUrl(infoHash: string, video: number): string {
  return mountPath(`api/stream/${encodeURIComponent(infoHash)}/${encodeURIComponent(String(video))}`)
}
