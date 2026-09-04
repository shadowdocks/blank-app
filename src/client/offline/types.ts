import type { MediaType } from "../../shared/media";

export type DownloadStatus =
  | "idle"
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export type StorageType = "opfs" | "idb";

export interface ByteRange {
  start: number;
  end: number;
}

export interface ChunkRecord {
  downloadId: string;
  index: number;
  start: number;
  end: number;
  data: ArrayBuffer;
}

export interface StoredFileRecord {
  downloadId: string;
  fileKey: string;
  data: ArrayBuffer;
  mimeType: string;
  size: number;
  updatedAt: number;
}

export interface SubtitleTrackInfo {
  id: string;
  label: string;
  language: string;
  url: string;
  format?: "vtt" | "srt" | string;
  downloaded: boolean;
  failed?: boolean;
  size?: number;
  mimeType?: string;
}

export interface ArtworkInfo {
  posterUrl?: string | null;
  downloadedPoster: boolean;
  backdropUrl?: string | null;
  downloadedBackdrop: boolean;
  posterMimeType?: string;
  backdropMimeType?: string;
}

export interface DownloadManifest {
  id: string;
  title: string;
  mediaType: MediaType;
  year?: number | null;
  mediaUrl: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
  downloadedBytes: number;
  chunkSize: number;
  status: DownloadStatus;
  storageType: StorageType;
  completedRanges: ByteRange[];
  subtitles: SubtitleTrackInfo[];
  artwork: ArtworkInfo;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
}

export interface CreateDownloadOptions {
  id: string;
  title: string;
  mediaType?: MediaType;
  year?: number | null;
  mediaUrl: string;
  filename?: string;
  mimeType?: string;
  totalBytes?: number;
  chunkSize?: number;
  subtitles?: Array<{
    id: string;
    label: string;
    language: string;
    url: string;
    format?: string;
  }>;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface StorageInspection {
  quota: number;
  usage: number;
  available: number;
  percentUsed: number;
  isPersistent: boolean;
  supportsOPFS: boolean;
  supportsIDB: boolean;
}

export type ServiceWorkerStateKind =
  | "unsupported"
  | "installing"
  | "installed"
  | "waiting"
  | "active"
  | "redundant"
  | "error";

export interface ServiceWorkerUpdateEvent {
  type: "installed" | "waiting" | "controlling" | "activated" | "redundant";
  registration?: ServiceWorkerRegistration;
}

export interface InstallabilityState {
  isInstallable: boolean;
  isInstalled: boolean;
  canPrompt: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}
