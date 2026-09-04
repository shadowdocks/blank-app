/**
 * Hawk Service Worker
 *
 * Provides:
 * - Mount-aware shell precaching (supporting / and /~/+/)
 * - Network-first navigation with offline shell fallback
 * - Explicit bypass for API and streaming torrent endpoints
 * - Range/HEAD handling for explicitly downloaded offline media
 *   (preferring Origin Private File System, falling back to IndexedDB chunks)
 */

/* eslint-disable no-restricted-globals */

const CACHE_NAME = "hawk-shell-v1";
const OFFLINE_DB_NAME = "hawk-offline-db";
const DB_VERSION = 1;

/**
 * Replaceable precache asset manifest placeholder.
 * Primary build scripts or tools can inject bundle assets here.
 */
const PRECACHE_ASSETS = /* __PRECACHE_ASSETS__ */ [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

const OFFLINE_MEDIA_REGEX = /(?:^|\/)offline-media\/([^/]+)(?:\/(media|video|artwork|poster|backdrop|subtitles\/[^/]+))?$/;

// ============================================================================
// Service Worker Lifecycle
// ============================================================================

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const base = self.registration.scope || self.location.href;
      const targets = PRECACHE_ASSETS.map((asset) => new URL(asset, base).href);

      await Promise.all(targets.map(async (url) => {
        const response = await fetch(url, { cache: "reload" });
        if (!response.ok) throw new Error(`Precache failed: ${response.status}`);
        await cache.put(url, response);
      }));
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key.startsWith("hawk-shell-")) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ============================================================================
// IndexedDB Helper for Offline Media
// ============================================================================

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not supported"));
      return;
    }
    const request = indexedDB.open(OFFLINE_DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getOfflineManifest(downloadId) {
  try {
    const db = await openOfflineDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("manifests", "readonly");
      const store = tx.objectStore("manifests");
      const req = store.get(downloadId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function getIDBChunksInRange(downloadId, startChunk, endChunk) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("media_chunks", "readonly");
    const store = tx.objectStore("media_chunks");
    const chunks = [];
    let current = startChunk;

    function fetchNext() {
      if (current > endChunk) {
        resolve(chunks);
        return;
      }
      const req = store.get([downloadId, current]);
      req.onsuccess = () => {
        if (req.result) {
          chunks.push(req.result);
        }
        current++;
        fetchNext();
      };
      req.onerror = () => reject(req.error);
    }

    fetchNext();
  });
}

async function getIDBStoredFile(downloadId, fileKey) {
  try {
    const db = await openOfflineDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const store = tx.objectStore("files");
      const req = store.get([downloadId, fileKey]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

// ============================================================================
// OPFS File Reader
// ============================================================================

async function getOPFSFile(downloadId) {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const hawkDir = await root.getDirectoryHandle("hawk-offline", { create: false });
    const itemDir = await hawkDir.getDirectoryHandle(downloadId, { create: false });
    const fileHandle = await itemDir.getFileHandle("media.bin", { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

async function getOPFSAuxFile(downloadId, fileKey) {
  if (!navigator.storage || !navigator.storage.getDirectory) {
    return null;
  }
  try {
    const root = await navigator.storage.getDirectory();
    const hawkDir = await root.getDirectoryHandle("hawk-offline", { create: false });
    const itemDir = await hawkDir.getDirectoryHandle(downloadId, { create: false });
    const filesDir = await itemDir.getDirectoryHandle("files", { create: false });
    const fileHandle = await filesDir.getFileHandle(fileKey, { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

// ============================================================================
// Offline Media Request Handler (Range / HEAD support)
// ============================================================================

function parseHttpRange(rangeHeader, totalSize) {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) {
    return null;
  }
  const spec = rangeHeader.slice(6).trim();
  if (spec.includes(",")) {
    // Single range only
    return null;
  }
  const [startStr, endStr] = spec.split("-");
  let start = NaN;
  let end = NaN;

  if (startStr === "") {
    // Suffix range: -suffixLength
    const suffix = parseInt(endStr, 10);
    if (isNaN(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = endStr ? parseInt(endStr, 10) : totalSize - 1;
  }

  if (isNaN(start) || isNaN(end) || start < 0 || start > end || start >= totalSize) {
    return null;
  }
  end = Math.min(end, totalSize - 1);
  return { start, end };
}

async function handleOfflineMediaRequest(request, downloadId, action) {
  const manifest = await getOfflineManifest(downloadId);
  if (!manifest) {
    return new Response("Media not found in offline storage", { status: 404 });
  }
  if (manifest.status !== "completed" || !manifest.totalBytes) {
    return new Response("Media download is not complete", { status: 409 });
  }

  const mimeType = manifest.mimeType || "video/mp4";
  const totalBytes = manifest.totalBytes || 0;

  // Handling subtitles or artwork
  if (action && action.startsWith("subtitles/")) {
    const subtitleId = action.slice("subtitles/".length);
    const fileKey = `sub_${subtitleId}`;
    const subtitle = manifest.subtitles.find((entry) => entry.id === subtitleId);
    const opfsFile = await getOPFSAuxFile(downloadId, fileKey);
    if (opfsFile) {
      return new Response(opfsFile, {
        status: 200,
        headers: {
          "Content-Type": subtitle?.mimeType || "text/vtt; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const idbRecord = await getIDBStoredFile(downloadId, fileKey);
    if (idbRecord && idbRecord.data) {
      return new Response(idbRecord.data, {
        status: 200,
        headers: {
          "Content-Type": idbRecord.mimeType || "text/vtt; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return new Response("Subtitle track not found", { status: 404 });
  }

  if (action === "artwork" || action === "poster" || action === "backdrop") {
    const fileKey = action === "artwork" ? "poster" : action;
    const opfsFile = await getOPFSAuxFile(downloadId, fileKey);
    if (opfsFile) {
      return new Response(opfsFile, {
        status: 200,
        headers: {
          "Content-Type": action === "backdrop"
            ? manifest.artwork.backdropMimeType || "image/jpeg"
            : manifest.artwork.posterMimeType || "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      });
    }
    const idbRecord = await getIDBStoredFile(downloadId, fileKey);
    if (idbRecord && idbRecord.data) {
      return new Response(idbRecord.data, {
        status: 200,
        headers: {
          "Content-Type": idbRecord.mimeType || "image/jpeg",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return new Response("Artwork not found", { status: 404 });
  }

  // Handle Video Resource (HEAD & GET Range)
  if (request.method === "HEAD") {
    return new Response(null, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(totalBytes),
        "Content-Type": mimeType,
        "Cache-Control": "no-cache",
      },
    });
  }

  const rangeHeader = request.headers.get("Range");

  // If no Range header, return full content (or 206 for byte range 0-(totalBytes-1))
  if (!rangeHeader) {
    const opfsFile = await getOPFSFile(downloadId);
    if (opfsFile) {
      return new Response(opfsFile, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(totalBytes),
          "Content-Type": mimeType,
        },
      });
    }
  }

  const range = parseHttpRange(rangeHeader || `bytes=0-${totalBytes - 1}`, totalBytes);
  if (!range) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${totalBytes}`,
      },
    });
  }

  const { start, end } = range;
  const contentLength = end - start + 1;

  // 1. Try serving slice from OPFS
  const opfsFile = await getOPFSFile(downloadId);
  if (opfsFile) {
    const slice = opfsFile.slice(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${totalBytes}`,
        "Content-Length": String(contentLength),
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
      },
    });
  }

  // 2. Fallback: Assemble bytes from IndexedDB chunks
  const chunkSize = manifest.chunkSize || 2 * 1024 * 1024;
  const startChunk = Math.floor(start / chunkSize);
  const endChunk = Math.floor(end / chunkSize);

  const chunkRecords = await getIDBChunksInRange(downloadId, startChunk, endChunk);
  const buffer = new Uint8Array(contentLength);
  let written = 0;

  for (const record of chunkRecords) {
    if (!record || !record.data) continue;
    const chunkStart = record.start;
    const chunkEnd = record.end;

    // Check overlap with [start, end]
    const sliceStartInChunk = Math.max(0, start - chunkStart);
    const sliceEndInChunk = Math.min(record.data.byteLength, end - chunkStart + 1);

    if (sliceStartInChunk < sliceEndInChunk) {
      const chunkBytes = new Uint8Array(record.data, sliceStartInChunk, sliceEndInChunk - sliceStartInChunk);
      const destination = Math.max(start, chunkStart) - start;
      buffer.set(chunkBytes, destination);
      written += chunkBytes.byteLength;
    }
  }

  if (written !== contentLength) {
    return new Response("Offline media is incomplete", { status: 409 });
  }

  return new Response(buffer, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${start}-${end}/${totalBytes}`,
      "Content-Length": String(contentLength),
      "Content-Type": mimeType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-cache",
    },
  });
}

// ============================================================================
// Network-First Navigation & Offline Shell Fallback
// ============================================================================

async function handleNavigation(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.ok) {
      return networkResponse;
    }
    throw new Error("Navigation network response was not ok");
  } catch {
    const cache = await caches.open(CACHE_NAME);

    // 1. Direct match
    const directMatch = await cache.match(request);
    if (directMatch) return directMatch;

    // 2. Scope-relative index.html
    const scope = self.registration.scope;
    const scopeIndex = await cache.match(new URL("index.html", scope).href);
    if (scopeIndex) return scopeIndex;

    const scopeRoot = await cache.match(new URL("./", scope).href);
    if (scopeRoot) return scopeRoot;

    // 3. Fallback to any cached index.html or root
    const fallback = (await cache.match("./index.html")) || (await cache.match("./"));
    if (fallback) return fallback;

    return new Response("Offline shell unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
  }
}

// ============================================================================
// Fetch Interception
// ============================================================================

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Never cache or intercept non-GET requests (except HEAD for offline media)
  if (request.method !== "GET" && request.method !== "HEAD") {
    return;
  }

  // 2. Avoid caching API / streaming playback accidentally
  // Specifically: /api/** endpoints and torrent streaming
  if (url.pathname.includes("/api/") || url.pathname.includes("/torrent/") || url.searchParams.has("torrent")) {
    return;
  }

  // 3. Check for explicitly downloaded offline media
  const mediaMatch = url.pathname.match(OFFLINE_MEDIA_REGEX);
  if (mediaMatch) {
    const downloadId = decodeURIComponent(mediaMatch[1]);
    const action = mediaMatch[2] || "video";
    event.respondWith(handleOfflineMediaRequest(request, downloadId, action));
    return;
  }

  // 4. Network-first navigation with offline shell fallback
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  // 5. Static precached assets: cache-first with network fallback
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return new Response("Network error", { status: 408 });
      }
    })()
  );
});
