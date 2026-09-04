import { mountBase } from "@/lib/router";
import {
  CapabilityError,
  DownloadAbortedError,
  OfflineError,
  QuotaExceededError,
} from "../errors";
import {
  applyArtworkCompletion,
  applyChunkCompletion,
  applyStatusTransition,
  applySubtitleCompletion,
  applySubtitleFailure,
  calculateManifestProgress,
  createDownloadManifest,
  DEFAULT_CHUNK_SIZE,
} from "../manifest";
import {
  calculateChunkPlan,
  calculateMissingRanges,
  parseContentRangeHeader,
  type ChunkPlan,
} from "../range";
import { defaultStorageAdapter, OfflineStorageAdapter } from "../storage/adapter";
import {
  getAllManifests,
  saveManifest,
} from "../storage/idb";
import { checkStorageAvailability, requestPersistence } from "../storage/quota";
import type {
  CreateDownloadOptions,
  DownloadManifest,
  DownloadStatus,
  StorageType,
} from "../types";

export type DownloadListener = (manifests: DownloadManifest[]) => void;

export class DownloadManager {
  private activeControllers = new Map<string, AbortController>();
  private manifests = new Map<string, DownloadManifest>();
  private listeners = new Set<DownloadListener>();
  private isInitialized = false;

  constructor(private storageAdapter: OfflineStorageAdapter = defaultStorageAdapter) {}

  async init(): Promise<void> {
    if (this.isInitialized) return;
    try {
      const persisted = await getAllManifests();
      for (const m of persisted) {
        const migrated = m.status === "completed" || m.chunkSize >= DEFAULT_CHUNK_SIZE
          ? m
          : { ...m, chunkSize: DEFAULT_CHUNK_SIZE };
        // Any download left in "downloading" or "queued" from a previous session becomes "paused"
        if (migrated.status === "downloading" || migrated.status === "queued") {
          const paused = applyStatusTransition(migrated, "paused");
          this.manifests.set(migrated.id, paused);
          await saveManifest(paused);
        } else {
          this.manifests.set(migrated.id, migrated);
          if (migrated !== m) await saveManifest(migrated);
        }
      }
      this.isInitialized = true;
      this.notify();
    } catch {
      this.isInitialized = true;
    }
  }

  getManifests(): DownloadManifest[] {
    return Array.from(this.manifests.values());
  }

  getManifest(id: string): DownloadManifest | undefined {
    return this.manifests.get(id);
  }

  subscribe(listener: DownloadListener): () => void {
    this.listeners.add(listener);
    // Emit initial snapshot
    listener(this.getManifests());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const list = this.getManifests();
    for (const listener of this.listeners) {
      try {
        listener(list);
      } catch {
        // Avoid listener errors crashing the manager
      }
    }
  }

  private async updateManifest(manifest: DownloadManifest): Promise<void> {
    this.manifests.set(manifest.id, manifest);
    await saveManifest(manifest);
    this.notify();
  }

  getOfflineMediaUrl(id: string): string {
    const base = mountBase();
    return `${base}offline-media/${encodeURIComponent(id)}/video`;
  }

  getOfflineSubtitleUrl(id: string, subtitleId: string): string {
    const base = mountBase();
    return `${base}offline-media/${encodeURIComponent(id)}/subtitles/${encodeURIComponent(subtitleId)}`;
  }

  getOfflineArtworkUrl(id: string, type: "poster" | "backdrop" = "poster"): string {
    const base = mountBase();
    return `${base}offline-media/${encodeURIComponent(id)}/${type}`;
  }

  /**
   * Probe source media to discover Content-Length, Content-Type, and Range capability.
   */
  private async probeSource(mediaUrl: string): Promise<{
    totalBytes: number;
    mimeType: string;
    supportsRanges: boolean;
  }> {
    let totalBytes = 0;
    let mimeType = "video/mp4";
    let supportsRanges = false;

    // 1. Try HEAD request
    try {
      const headRes = await fetch(mediaUrl, { method: "HEAD" });
      if (headRes.ok) {
        const cl = headRes.headers.get("content-length");
        if (cl) totalBytes = parseInt(cl, 10);
        const ct = headRes.headers.get("content-type");
        if (ct) mimeType = ct;
        const ar = headRes.headers.get("accept-ranges");
        if (ar && ar.toLowerCase().includes("bytes")) {
          supportsRanges = true;
        }
      }
    } catch {
      // HEAD may be blocked by CORS or unsupported on some servers
    }

    // 2. If range support not yet confirmed or totalBytes unknown, probe with Range bytes=0-0
    if (!supportsRanges || totalBytes <= 0) {
      try {
        const rangeRes = await fetch(mediaUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
        });

        if (rangeRes.status === 206) {
          supportsRanges = true;
          const cr = rangeRes.headers.get("content-range");
          const parsed = parseContentRangeHeader(cr);
          if (parsed && parsed.total) {
            totalBytes = parsed.total;
          }
          const ct = rangeRes.headers.get("content-type");
          if (ct) mimeType = ct;
        } else if (rangeRes.ok) {
          // Server returned 200 OK ignoring Range header
          supportsRanges = false;
          const cl = rangeRes.headers.get("content-length");
          if (cl) totalBytes = parseInt(cl, 10);
        }
        await rangeRes.body?.cancel();
      } catch {
        // Network or CORS error
      }
    }

    return { totalBytes, mimeType, supportsRanges };
  }

  async startDownload(options: CreateDownloadOptions): Promise<string> {
    await this.init();

    const existing = this.manifests.get(options.id);
    if (existing && (existing.status === "downloading" || existing.status === "completed")) {
      return existing.id;
    }

    // Probe source
    const probed = await this.probeSource(options.mediaUrl);
    const totalBytes = probed.totalBytes || options.totalBytes || 0;
    const mimeType = options.mimeType || probed.mimeType;

    if (!probed.supportsRanges) {
      throw new CapabilityError("This source cannot be downloaded in resumable chunks", "HTTP_RANGE");
    }

    if (totalBytes > 0) {
      // Verify storage quota
      const quotaCheck = await checkStorageAvailability(totalBytes);
      if (!quotaCheck.ok) {
        throw new QuotaExceededError(quotaCheck.reason, totalBytes);
      }
    }

    // Request persistence from browser
    await requestPersistence();

    const storageType: StorageType = await this.storageAdapter.getPreferredStorageType();

    let manifest = existing
      ? {
          ...existing,
          mediaUrl: options.mediaUrl,
          totalBytes: totalBytes || existing.totalBytes,
          mimeType: mimeType || existing.mimeType,
          status: "queued" as DownloadStatus,
        }
      : createDownloadManifest(
          {
            ...options,
            totalBytes,
            mimeType,
          },
          storageType
        );

    await this.updateManifest(manifest);

    // Launch download loop in background
    void this.executeDownload(manifest.id).catch(async (err) => {
      const current = this.manifests.get(manifest.id);
      if (current) {
        await this.updateManifest(
          applyStatusTransition(
            current,
            "error",
            err instanceof Error ? err.message : "Download failed"
          )
        );
      }
    });

    return manifest.id;
  }

  async pauseDownload(id: string): Promise<void> {
    const controller = this.activeControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(id);
    }

    const manifest = this.manifests.get(id);
    if (manifest && manifest.status !== "completed") {
      await this.updateManifest(applyStatusTransition(manifest, "paused"));
    }
  }

  async resumeDownload(id: string): Promise<void> {
    await this.init();
    const manifest = this.manifests.get(id);
    if (!manifest) {
      throw new OfflineError(`Download manifest ${id} not found`, "NOT_FOUND");
    }

    if (manifest.status === "completed" || manifest.status === "downloading") {
      return;
    }

    await this.updateManifest(applyStatusTransition(manifest, "queued"));
    void this.executeDownload(id).catch(async (err) => {
      const current = this.manifests.get(id);
      if (current) {
        await this.updateManifest(
          applyStatusTransition(
            current,
            "error",
            err instanceof Error ? err.message : "Download failed"
          )
        );
      }
    });
  }

  async cancelDownload(id: string): Promise<void> {
    const controller = this.activeControllers.get(id);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(id);
    }

    const manifest = this.manifests.get(id);
    if (manifest) {
      await this.updateManifest(applyStatusTransition(manifest, "cancelled"));
    }
  }

  async deleteDownload(id: string): Promise<void> {
    await this.cancelDownload(id);
    this.manifests.delete(id);
    await this.storageAdapter.deleteDownloadData(id);
    this.notify();
  }

  private async executeDownload(id: string): Promise<void> {
    let manifest = this.manifests.get(id);
    if (!manifest) return;

    const controller = new AbortController();
    this.activeControllers.set(id, controller);

    manifest = applyStatusTransition(manifest, "downloading");
    await this.updateManifest(manifest);

    try {
      // 1. Download auxiliary files: Subtitles
      await this.downloadSubtitles(manifest, controller.signal);
      manifest = this.manifests.get(id) || manifest;

      // 2. Download auxiliary files: Artwork (Poster and Backdrop)
      await this.downloadArtwork(manifest, controller.signal);
      manifest = this.manifests.get(id) || manifest;

      // 3. Download Media Chunks via Byte-Ranges
      if (manifest.totalBytes <= 0) {
        // Source total size could not be determined; throw capability error
        throw new CapabilityError(
          "Source stream does not declare length or support byte ranges",
          "HTTP_RANGE"
        );
      }

      const allChunks = calculateChunkPlan(manifest.totalBytes, manifest.chunkSize);
      const missingRanges = calculateMissingRanges(manifest.totalBytes, manifest.completedRanges);

      // Filter chunks overlapping with missing ranges
      const chunksToFetch = allChunks.filter((chunk) =>
        missingRanges.some((missing) => chunk.start <= missing.end && chunk.end >= missing.start)
      );

      for (const chunk of chunksToFetch) {
        if (controller.signal.aborted) {
          throw new DownloadAbortedError();
        }

        await this.fetchAndStoreChunk(manifest, chunk, controller.signal);
        manifest = this.manifests.get(id) || manifest;
      }

      // Check completion
      const progress = calculateManifestProgress(manifest);
      if (progress.isComplete) {
        manifest = applyStatusTransition(manifest, "completed");
        await this.updateManifest(manifest);
      }
    } catch (err) {
      if (
        controller.signal.aborted ||
        err instanceof DownloadAbortedError ||
        (err instanceof DOMException && err.name === "AbortError")
      ) {
        // Paused or cancelled cleanly
        return;
      }
      throw err;
    } finally {
      this.activeControllers.delete(id);
    }
  }

  private async fetchAndStoreChunk(
    manifest: DownloadManifest,
    chunk: ChunkPlan,
    signal: AbortSignal
  ): Promise<void> {
    const headers = new Headers();
    headers.set("Range", `bytes=${chunk.start}-${chunk.end}`);

    const res = await fetch(manifest.mediaUrl, {
      headers,
      signal,
    });

    if (res.status !== 206) {
      throw new OfflineError(
        `Source did not honor byte range for chunk ${chunk.index} (status: ${res.status})`,
        "CHUNK_FETCH_FAILED"
      );
    }

    const contentRange = parseContentRangeHeader(res.headers.get("content-range"));
    if (
      !contentRange ||
      contentRange.start !== chunk.start ||
      contentRange.end !== chunk.end ||
      (contentRange.total !== null && contentRange.total !== manifest.totalBytes)
    ) {
      await res.body?.cancel();
      throw new OfflineError(`Source returned the wrong bytes for chunk ${chunk.index}`, "CHUNK_FETCH_FAILED");
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength !== chunk.size) {
      throw new OfflineError(`Source returned an incomplete chunk ${chunk.index}`, "CHUNK_FETCH_FAILED");
    }

    // Stream chunk directly to storage adapter
    await this.storageAdapter.writeMediaChunk(
      manifest.id,
      manifest.storageType,
      chunk.index,
      chunk.start,
      chunk.end,
      buffer
    );

    // Update manifest state
    const updated = applyChunkCompletion(manifest, { start: chunk.start, end: chunk.end });
    await this.updateManifest(updated);
  }

  private async downloadSubtitles(
    manifest: DownloadManifest,
    signal: AbortSignal
  ): Promise<void> {
    for (const sub of manifest.subtitles) {
      if (sub.downloaded) continue;
      if (signal.aborted) return;

      try {
        const res = await fetch(sub.url, { signal });
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const mime = res.headers.get("content-type") || "text/vtt; charset=utf-8";
          await this.storageAdapter.saveFile(
            manifest.id,
            `sub_${sub.id}`,
            buffer,
            mime,
            manifest.storageType
          );

          manifest = applySubtitleCompletion(manifest, sub.id, buffer.byteLength, mime);
          await this.updateManifest(manifest);
        } else {
          manifest = applySubtitleFailure(manifest, sub.id);
          await this.updateManifest(manifest);
        }
      } catch (err) {
        if (signal.aborted) return;
        manifest = applySubtitleFailure(manifest, sub.id);
        await this.updateManifest(manifest);
      }
    }
  }

  private async downloadArtwork(
    manifest: DownloadManifest,
    signal: AbortSignal
  ): Promise<void> {
    // Poster
    if (manifest.artwork.posterUrl && !manifest.artwork.downloadedPoster) {
      if (signal.aborted) return;
      try {
        const res = await fetch(manifest.artwork.posterUrl, { signal });
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const mime = res.headers.get("content-type") || "image/jpeg";
          await this.storageAdapter.saveFile(
            manifest.id,
            "poster",
            buffer,
            mime,
            manifest.storageType
          );

          manifest = applyArtworkCompletion(manifest, "poster", mime);
          await this.updateManifest(manifest);
        } else {
          manifest = {
            ...manifest,
            artwork: { ...manifest.artwork, posterUrl: null },
            updatedAt: Date.now(),
          };
          await this.updateManifest(manifest);
        }
      } catch {
        if (signal.aborted) return;
        manifest = {
          ...manifest,
          artwork: { ...manifest.artwork, posterUrl: null },
          updatedAt: Date.now(),
        };
        await this.updateManifest(manifest);
      }
    }

    // Backdrop
    if (manifest.artwork.backdropUrl && !manifest.artwork.downloadedBackdrop) {
      if (signal.aborted) return;
      try {
        const res = await fetch(manifest.artwork.backdropUrl, { signal });
        if (res.ok) {
          const buffer = await res.arrayBuffer();
          const mime = res.headers.get("content-type") || "image/jpeg";
          await this.storageAdapter.saveFile(
            manifest.id,
            "backdrop",
            buffer,
            mime,
            manifest.storageType
          );

          manifest = applyArtworkCompletion(manifest, "backdrop", mime);
          await this.updateManifest(manifest);
        } else {
          manifest = {
            ...manifest,
            artwork: { ...manifest.artwork, backdropUrl: null },
            updatedAt: Date.now(),
          };
          await this.updateManifest(manifest);
        }
      } catch {
        if (signal.aborted) return;
        manifest = {
          ...manifest,
          artwork: { ...manifest.artwork, backdropUrl: null },
          updatedAt: Date.now(),
        };
        await this.updateManifest(manifest);
      }
    }
  }
}

export const defaultDownloadManager = new DownloadManager();
