export type MediaType = "movie" | "tv"

export type TimeBucket = "quick" | "standard" | "epic"

/** A recommendation or search hit. Different sources fill different subsets. */
export interface Title {
  /** TMDB ids arrive as numbers, the IMDb fallback as "tt..." strings. */
  id?: string | number | null
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

/** The title a stream came from, so /watch can route back after a reload. */
export interface TorrentOrigin {
  type: MediaType
  id: string
}

export interface ActiveTorrent {
  infoHash: string
  video: number | null
  name: string
  magnet: string
  origin: TorrentOrigin | null
}

/**
 * Everything that survives a reload, mirrored into localStorage. The URL owns
 * the current screen and title; this is recovery data only.
 */
export interface Session {
  mood: string
  type: MediaType
  time: TimeBucket
  titles: Title[]
  sources: Source[]
  /** Title the cached sources belong to, so a shared link cannot show stale ones. */
  sourcesFor: string | null
  selectedMagnet: string | null
  torrent: ActiveTorrent | null
}
