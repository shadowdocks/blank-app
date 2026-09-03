export type MediaType = "movie" | "tv"

export type TimeBucket = "quick" | "standard" | "epic"

export type Phase = "pick" | "title" | "sources" | "watch"

/** A recommendation. TMDB and the curated fallback fill different subsets. */
export interface Title {
  id?: number | null
  mediaType?: MediaType | null
  title: string
  year?: string | null
  overview?: string | null
  rating?: number | null
  runtime?: number | null
  genres?: string[] | null
  posterUrl?: string | null
  backdropUrl?: string | null
}

export interface Source {
  name: string
  magnet: string
  seeds: number
  leeches?: number
  /** Pre-formatted by the server, e.g. "1.42 GB". */
  size: string
  source: string
  hash?: string
}

export interface TorrentStatus {
  infoHash: string
  name: string
  progress: number
  downloaded: number
  length: number
  numPeers: number
  downloadSpeed: number
  done: boolean
  /** Index of the playable file, or null while metadata is still resolving. */
  video: number | null
  metadata: boolean
  elapsedMs: number
  lastEvent: string
}

export interface ActiveTorrent {
  infoHash: string
  video: number | null
  name: string
  magnet: string
}

/** Everything that survives a reload, mirrored into localStorage. */
export interface Session {
  mood: string
  type: MediaType
  time: TimeBucket
  titles: Title[]
  titleIndex: number
  sources: Source[]
  selectedMagnet: string | null
  torrent: ActiveTorrent | null
  phase: Phase
}
