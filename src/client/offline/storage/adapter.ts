import type { StorageType } from "../types";
import {
  deleteChunksForDownload,
  deleteFilesForDownload,
  deleteManifest,
  getChunksInRange,
  getStoredFile,
  saveChunk,
  saveStoredFile,
} from "./idb";
import {
  deleteOPFSMedia,
  getOPFSMediaFile,
  isOPFSSupported,
  readOPFSAuxFile,
  readOPFSRange,
  saveOPFSAuxFile,
  writeOPFSChunk,
} from "./opfs";

export class OfflineStorageAdapter {
  private opfsAvailable: boolean | null = null;

  async getPreferredStorageType(): Promise<StorageType> {
    if (this.opfsAvailable === null) {
      this.opfsAvailable = await isOPFSSupported();
    }
    return this.opfsAvailable ? "opfs" : "idb";
  }

  async writeMediaChunk(
    downloadId: string,
    storageType: StorageType,
    index: number,
    start: number,
    end: number,
    data: ArrayBuffer
  ): Promise<void> {
    if (storageType === "opfs") {
      await writeOPFSChunk(downloadId, start, data);
      return;
    }
    await saveChunk(downloadId, index, start, end, data);
  }

  async readMediaRange(
    downloadId: string,
    storageType: StorageType,
    start: number,
    length: number,
    chunkSize: number
  ): Promise<Uint8Array> {
    if (storageType === "opfs") {
      try {
        const buffer = await readOPFSRange(downloadId, start, length);
        return new Uint8Array(buffer);
      } catch {
        // Fall back to IDB
      }
    }

    const end = start + length - 1;
    const startChunk = Math.floor(start / chunkSize);
    const endChunk = Math.floor(end / chunkSize);

    const chunkRecords = await getChunksInRange(downloadId, startChunk, endChunk);
    const buffer = new Uint8Array(length);
    let written = 0;

    for (const record of chunkRecords) {
      if (!record || !record.data) continue;
      const chunkStart = record.start;
      const sliceStart = Math.max(0, start - chunkStart);
      const sliceEnd = Math.min(record.data.byteLength, end - chunkStart + 1);

      if (sliceStart < sliceEnd) {
        const chunkBytes = new Uint8Array(record.data, sliceStart, sliceEnd - sliceStart);
        buffer.set(chunkBytes, written);
        written += chunkBytes.byteLength;
      }
    }

    return buffer.subarray(0, written);
  }

  async getMediaBlob(downloadId: string, _mimeType?: string): Promise<Blob | null> {
    const opfsFile = await getOPFSMediaFile(downloadId);
    if (opfsFile) {
      return opfsFile;
    }
    return null;
  }

  async saveFile(
    downloadId: string,
    fileKey: string,
    data: ArrayBuffer,
    mimeType: string,
    storageType: StorageType
  ): Promise<void> {
    if (storageType === "opfs") {
      await saveOPFSAuxFile(downloadId, fileKey, data);
      return;
    }
    await saveStoredFile(downloadId, fileKey, data, mimeType);
  }

  async readFile(
    downloadId: string,
    fileKey: string,
    storageType: StorageType
  ): Promise<{ data: ArrayBuffer; mimeType: string } | null> {
    if (storageType === "opfs") {
      const opfsData = await readOPFSAuxFile(downloadId, fileKey);
      if (opfsData) {
        const record = await getStoredFile(downloadId, fileKey);
        return { data: opfsData, mimeType: record?.mimeType || "application/octet-stream" };
      }
    }

    const record = await getStoredFile(downloadId, fileKey);
    if (record) {
      return { data: record.data, mimeType: record.mimeType };
    }

    return null;
  }

  async deleteDownloadData(downloadId: string): Promise<void> {
    await Promise.all([
      deleteOPFSMedia(downloadId),
      deleteChunksForDownload(downloadId),
      deleteFilesForDownload(downloadId),
      deleteManifest(downloadId),
    ]);
  }
}

export const defaultStorageAdapter = new OfflineStorageAdapter();
