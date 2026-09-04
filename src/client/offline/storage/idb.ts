import type {
  ChunkRecord,
  DownloadManifest,
  StoredFileRecord,
} from "../types";
import { StorageUnavailableError } from "../errors";

export const OFFLINE_DB_NAME = "hawk-offline-db";
export const OFFLINE_DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openOfflineDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new StorageUnavailableError("IndexedDB is not supported in this environment"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("manifests")) {
        db.createObjectStore("manifests", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("media_chunks")) {
        const chunkStore = db.createObjectStore("media_chunks", {
          keyPath: ["downloadId", "index"],
        });
        chunkStore.createIndex("downloadId", "downloadId", { unique: false });
      }

      if (!db.objectStoreNames.contains("files")) {
        const fileStore = db.createObjectStore("files", {
          keyPath: ["downloadId", "fileKey"],
        });
        fileStore.createIndex("downloadId", "downloadId", { unique: false });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new StorageUnavailableError("Failed to open IndexedDB"));
    };

    request.onblocked = () => {
      // Another tab is keeping an older version open
    };
  });

  return dbPromise;
}

export async function saveManifest(manifest: DownloadManifest): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("manifests", "readwrite");
    const store = tx.objectStore("manifests");
    const req = store.put(manifest);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getManifest(id: string): Promise<DownloadManifest | undefined> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("manifests", "readonly");
    const store = tx.objectStore("manifests");
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result as DownloadManifest | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllManifests(): Promise<DownloadManifest[]> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("manifests", "readonly");
    const store = tx.objectStore("manifests");
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as DownloadManifest[]) || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteManifest(id: string): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("manifests", "readwrite");
    const store = tx.objectStore("manifests");
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveChunk(
  downloadId: string,
  index: number,
  start: number,
  end: number,
  data: ArrayBuffer
): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media_chunks", "readwrite");
    const store = tx.objectStore("media_chunks");
    const record: ChunkRecord = { downloadId, index, start, end, data };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getChunk(
  downloadId: string,
  index: number
): Promise<ChunkRecord | undefined> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media_chunks", "readonly");
    const store = tx.objectStore("media_chunks");
    const req = store.get([downloadId, index]);
    req.onsuccess = () => resolve(req.result as ChunkRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function getChunksInRange(
  downloadId: string,
  startChunk: number,
  endChunk: number
): Promise<ChunkRecord[]> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media_chunks", "readonly");
    const store = tx.objectStore("media_chunks");
    const results: ChunkRecord[] = [];
    let current = startChunk;

    function next() {
      if (current > endChunk) {
        resolve(results);
        return;
      }
      const req = store.get([downloadId, current]);
      req.onsuccess = () => {
        if (req.result) {
          results.push(req.result as ChunkRecord);
        }
        current++;
        next();
      };
      req.onerror = () => reject(req.error);
    }

    next();
  });
}

export async function deleteChunksForDownload(downloadId: string): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media_chunks", "readwrite");
    const store = tx.objectStore("media_chunks");
    const index = store.index("downloadId");
    const range = IDBKeyRange.only(downloadId);
    const req = index.openKeyCursor(range);

    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveStoredFile(
  downloadId: string,
  fileKey: string,
  data: ArrayBuffer,
  mimeType: string
): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const record: StoredFileRecord = {
      downloadId,
      fileKey,
      data,
      mimeType,
      size: data.byteLength,
      updatedAt: Date.now(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getStoredFile(
  downloadId: string,
  fileKey: string
): Promise<StoredFileRecord | undefined> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const req = store.get([downloadId, fileKey]);
    req.onsuccess = () => resolve(req.result as StoredFileRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteFilesForDownload(downloadId: string): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const index = store.index("downloadId");
    const range = IDBKeyRange.only(downloadId);
    const req = index.openKeyCursor(range);

    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursor | null>).result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllOfflineStorage(): Promise<void> {
  const db = await openOfflineDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["manifests", "media_chunks", "files"], "readwrite");
    tx.objectStore("manifests").clear();
    tx.objectStore("media_chunks").clear();
    tx.objectStore("files").clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
