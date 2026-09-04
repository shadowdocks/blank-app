import type { MediaTarget } from "../../shared/playback";
export type { PlaybackStatus, SubtitleTrack, TorrentFile } from "../../shared/playback";

export interface RqbitFile {
  name: string;
  length: number;
  included: boolean;
}

export interface RqbitDetails {
  id?: number;
  info_hash: string;
  name?: string;
  files?: RqbitFile[];
}

export interface RqbitStats {
  state: "initializing" | "live" | "paused" | "error";
  error?: string | null;
  progress_bytes: number;
  total_bytes: number;
  finished: boolean;
  live?: {
    download_speed?: { mbps?: number };
    snapshot?: {
      peer_stats?: { live?: number };
    };
  } | null;
}

export interface TorrentPoolConfig {
  maxTorrents: number;
  idleTtlMs: number;
  recentStreamGraceMs: number;
}

export interface TorrentPoolEntry {
  hash: string;
  name: string;
  startedAt: number;
  lastAccessedAt: number;
  lastStreamedAt: number | null;
  activeStreams: number;
  preferredFileIndex: number | null;
  target?: MediaTarget;
  details: RqbitDetails | null;
}

export interface TorrentDiagnosticData {
  engine: string;
  runtime: string;
  peerLimit: number;
  poolSize: number;
  maxPoolSize: number;
  activeStreams: number;
  peers: unknown;
}
