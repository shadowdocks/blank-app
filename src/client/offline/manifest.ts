import { calculateCompletedBytes, mergeByteRanges } from "./range";
import type {
  ArtworkInfo,
  ByteRange,
  CreateDownloadOptions,
  DownloadManifest,
  DownloadStatus,
  StorageType,
  SubtitleTrackInfo,
} from "./types";

export const DEFAULT_CHUNK_SIZE = 16 * 1024 * 1024; // 16 MiB reduces request and storage overhead

export function createDownloadManifest(
  options: CreateDownloadOptions,
  storageType: StorageType = "idb"
): DownloadManifest {
  const now = Date.now();
  const subtitles: SubtitleTrackInfo[] = (options.subtitles || []).map((sub) => ({
    id: sub.id,
    label: sub.label,
    language: sub.language,
    url: sub.url,
    format: sub.format ?? "vtt",
    downloaded: false,
  }));

  const artwork: ArtworkInfo = {
    posterUrl: options.posterUrl ?? null,
    downloadedPoster: false,
    backdropUrl: options.backdropUrl ?? null,
    downloadedBackdrop: false,
  };

  return {
    id: options.id,
    title: options.title,
    mediaType: options.mediaType ?? "movie",
    year: options.year ?? null,
    mediaUrl: options.mediaUrl,
    filename: options.filename ?? `${options.id}.mp4`,
    mimeType: options.mimeType ?? "video/mp4",
    totalBytes: options.totalBytes ?? 0,
    downloadedBytes: 0,
    chunkSize: options.chunkSize && options.chunkSize > 0 ? options.chunkSize : DEFAULT_CHUNK_SIZE,
    status: "idle",
    storageType,
    completedRanges: [],
    subtitles,
    artwork,
    metadata: options.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Updates completed byte ranges and downloaded byte count when a chunk finishes.
 * Automatically marks completed if all bytes are received.
 */
export function applyChunkCompletion(
  manifest: DownloadManifest,
  chunkRange: ByteRange
): DownloadManifest {
  const nextRanges = mergeByteRanges([...manifest.completedRanges, chunkRange]);
  const downloadedBytes = calculateCompletedBytes(nextRanges);
  const now = Date.now();

  const isMediaDone = manifest.totalBytes > 0 && downloadedBytes >= manifest.totalBytes;
  const areSubsDone = manifest.subtitles.every((s) => s.downloaded || s.failed);
  const isArtworkDone =
    (!manifest.artwork.posterUrl || manifest.artwork.downloadedPoster) &&
    (!manifest.artwork.backdropUrl || manifest.artwork.downloadedBackdrop);

  const isCompleted = isMediaDone && areSubsDone && isArtworkDone;

  return {
    ...manifest,
    completedRanges: nextRanges,
    downloadedBytes,
    status: isCompleted ? "completed" : manifest.status,
    completedAt: isCompleted ? manifest.completedAt ?? now : undefined,
    updatedAt: now,
  };
}

/**
 * Applies a lifecycle status transition (e.g. paused, downloading, error, cancelled).
 */
export function applyStatusTransition(
  manifest: DownloadManifest,
  newStatus: DownloadStatus,
  error?: string
): DownloadManifest {
  const now = Date.now();
  return {
    ...manifest,
    status: newStatus,
    error: error ?? (newStatus === "error" ? manifest.error : undefined),
    completedAt: newStatus === "completed" ? manifest.completedAt ?? now : undefined,
    updatedAt: now,
  };
}

export function applySubtitleCompletion(
  manifest: DownloadManifest,
  subtitleId: string,
  size?: number,
  mimeType?: string
): DownloadManifest {
  const nextSubtitles = manifest.subtitles.map((sub) => {
    if (sub.id === subtitleId) {
      return {
        ...sub,
        downloaded: true,
        size: size ?? sub.size,
        mimeType: mimeType ?? sub.mimeType ?? "text/vtt",
      };
    }
    return sub;
  });

  const now = Date.now();
  const areSubsDone = nextSubtitles.every((s) => s.downloaded || s.failed);
  const isMediaDone = manifest.totalBytes > 0 && manifest.downloadedBytes >= manifest.totalBytes;
  const isArtworkDone =
    (!manifest.artwork.posterUrl || manifest.artwork.downloadedPoster) &&
    (!manifest.artwork.backdropUrl || manifest.artwork.downloadedBackdrop);

  const isCompleted = isMediaDone && areSubsDone && isArtworkDone;

  return {
    ...manifest,
    subtitles: nextSubtitles,
    status: isCompleted ? "completed" : manifest.status,
    completedAt: isCompleted ? manifest.completedAt ?? now : undefined,
    updatedAt: now,
  };
}

export function applySubtitleFailure(
  manifest: DownloadManifest,
  subtitleId: string
): DownloadManifest {
  const now = Date.now();
  return {
    ...manifest,
    subtitles: manifest.subtitles.map((subtitle) => subtitle.id === subtitleId
      ? { ...subtitle, failed: true }
      : subtitle),
    updatedAt: now,
  };
}

export function applyArtworkCompletion(
  manifest: DownloadManifest,
  artworkType: "poster" | "backdrop",
  mimeType?: string
): DownloadManifest {
  const nextArtwork: ArtworkInfo = {
    ...manifest.artwork,
    ...(artworkType === "poster"
      ? { downloadedPoster: true, posterMimeType: mimeType ?? manifest.artwork.posterMimeType }
      : { downloadedBackdrop: true, backdropMimeType: mimeType ?? manifest.artwork.backdropMimeType }),
  };

  const now = Date.now();
  const areSubsDone = manifest.subtitles.every((s) => s.downloaded || s.failed);
  const isMediaDone = manifest.totalBytes > 0 && manifest.downloadedBytes >= manifest.totalBytes;
  const isArtworkDone =
    (!nextArtwork.posterUrl || nextArtwork.downloadedPoster) &&
    (!nextArtwork.backdropUrl || nextArtwork.downloadedBackdrop);

  const isCompleted = isMediaDone && areSubsDone && isArtworkDone;

  return {
    ...manifest,
    artwork: nextArtwork,
    status: isCompleted ? "completed" : manifest.status,
    completedAt: isCompleted ? manifest.completedAt ?? now : undefined,
    updatedAt: now,
  };
}

export function isDownloadComplete(manifest: DownloadManifest): boolean {
  if (manifest.status === "completed") return true;
  if (manifest.totalBytes <= 0) return false;
  if (manifest.downloadedBytes < manifest.totalBytes) return false;
  if (manifest.subtitles.some((s) => !s.downloaded && !s.failed)) return false;
  if (manifest.artwork.posterUrl && !manifest.artwork.downloadedPoster) return false;
  if (manifest.artwork.backdropUrl && !manifest.artwork.downloadedBackdrop) return false;
  return true;
}

export function calculateManifestProgress(manifest: DownloadManifest): {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  isComplete: boolean;
} {
  const total = manifest.totalBytes;
  const downloaded = manifest.downloadedBytes;
  if (total <= 0) {
    return { percent: 0, downloadedBytes: downloaded, totalBytes: total, isComplete: false };
  }
  const ratio = Math.min(1, Math.max(0, downloaded / total));
  const percent = Math.round(ratio * 1000) / 10;
  return {
    percent,
    downloadedBytes: downloaded,
    totalBytes: total,
    isComplete: isDownloadComplete(manifest),
  };
}
