import type { MediaSummary, MediaType } from "./media"

export interface MediaTarget {
  imdbId: string
  mediaType: MediaType
  title: string
  year: number | null
  season: number | null
  episode: number | null
  episodeTitle: string | null
}

export type VideoQuality = "2160p" | "1440p" | "1080p" | "720p" | "480p" | "unknown"
export type VideoContainer = "mp4" | "webm" | "mkv" | "avi" | "mov" | "ts" | "unknown"
export type AudioCodec = "aac" | "ac3" | "eac3" | "opus" | "mp3" | "unknown"

export interface ClientCapabilities {
  supportedAudioCodecs?: AudioCodec[]
  unsupportedAudioCodecs?: AudioCodec[]
  audioCodecs?: AudioCodec[]
}

export interface PlaybackSource {
  id: string
  provider: string
  name: string
  infoHash: string
  magnet: string
  fileIndex: number | null
  seeders: number
  leechers: number
  sizeBytes: number | null
  quality: VideoQuality
  container: VideoContainer
  codec: string | null
  hdr: string | null
  audioCodec?: AudioCodec
  score: number
}

export interface SubtitleTrack {
  id: string
  label: string
  language: string
  source: string
  format: "vtt" | "srt" | "ass"
  url: string
  hearingImpaired: boolean
}

export interface TorrentFile {
  index: number
  name: string
  length: number
  media: "video" | "subtitle" | "other"
}

export interface PlaybackStatus {
  id: string
  infoHash: string
  name: string
  /** Container of the file rqbit actually selected after reading torrent metadata. */
  container?: VideoContainer
  fileIndex: number | null
  streamUrl: string | null
  progress: number
  downloadedBytes: number
  totalBytes: number
  peers: number
  downloadSpeed: number
  ready: boolean
  complete: boolean
  state: "resolving" | "connecting" | "downloading" | "ready" | "complete" | "error"
  error: string | null
  subtitles: SubtitleTrack[]
}

export interface PlaybackRecord {
  media: MediaSummary
  season: number | null
  episode: number | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}
