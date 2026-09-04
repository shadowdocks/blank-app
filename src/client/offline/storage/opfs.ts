const OPFS_ROOT_DIR = "hawk-offline";

let opfsSupportCached: boolean | null = null;

/**
 * Probes whether the Origin Private File System (OPFS) and file writable handles
 * are fully supported in this context.
 */
export async function isOPFSSupported(): Promise<boolean> {
  if (opfsSupportCached !== null) return opfsSupportCached;

  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== "function"
  ) {
    opfsSupportCached = false;
    return false;
  }

  try {
    const root = await navigator.storage.getDirectory();
    // Test write support with a small hidden probe file
    const probeName = `.probe-${Date.now()}`;
    const fileHandle = await root.getFileHandle(probeName, { create: true });

    if (typeof fileHandle.createWritable !== "function") {
      // Browsers without createWritable on FileSystemFileHandle cannot stream-write chunks in this thread
      await root.removeEntry(probeName).catch(() => {});
      opfsSupportCached = false;
      return false;
    }

    const writable = await fileHandle.createWritable();
    await writable.write(new Uint8Array([1]));
    await writable.close();
    await root.removeEntry(probeName).catch(() => {});

    opfsSupportCached = true;
    return true;
  } catch {
    opfsSupportCached = false;
    return false;
  }
}

async function getOfflineRootDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return await root.getDirectoryHandle(OPFS_ROOT_DIR, { create: true });
}

async function getMediaDir(
  downloadId: string,
  create = true
): Promise<FileSystemDirectoryHandle> {
  const root = await getOfflineRootDir();
  return await root.getDirectoryHandle(downloadId, { create });
}

export async function writeOPFSChunk(
  downloadId: string,
  offset: number,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  const mediaDir = await getMediaDir(downloadId, true);
  const fileHandle = await mediaDir.getFileHandle("media.bin", { create: true });

  const writable = await fileHandle.createWritable({ keepExistingData: true });
  try {
    await writable.seek(offset);
    const bufferSource = (data instanceof Uint8Array ? data : new Uint8Array(data)) as unknown as BufferSource;
    await writable.write(bufferSource);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function readOPFSRange(
  downloadId: string,
  offset: number,
  length: number
): Promise<ArrayBuffer> {
  const mediaDir = await getMediaDir(downloadId, false);
  const fileHandle = await mediaDir.getFileHandle("media.bin", { create: false });
  const file = await fileHandle.getFile();
  const slice = file.slice(offset, offset + length);
  return await slice.arrayBuffer();
}

export async function getOPFSMediaFile(downloadId: string): Promise<File | null> {
  try {
    const mediaDir = await getMediaDir(downloadId, false);
    const fileHandle = await mediaDir.getFileHandle("media.bin", { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function saveOPFSAuxFile(
  downloadId: string,
  fileKey: string,
  data: ArrayBuffer | Uint8Array
): Promise<void> {
  const mediaDir = await getMediaDir(downloadId, true);
  const filesDir = await mediaDir.getDirectoryHandle("files", { create: true });
  // Sanitize key for filesystem
  const safeName = fileKey.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const fileHandle = await filesDir.getFileHandle(safeName, { create: true });

  const writable = await fileHandle.createWritable();
  try {
    const bufferSource = (data instanceof Uint8Array ? data : new Uint8Array(data)) as unknown as BufferSource;
    await writable.write(bufferSource);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

export async function readOPFSAuxFile(
  downloadId: string,
  fileKey: string
): Promise<ArrayBuffer | null> {
  try {
    const mediaDir = await getMediaDir(downloadId, false);
    const filesDir = await mediaDir.getDirectoryHandle("files", { create: false });
    const safeName = fileKey.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const fileHandle = await filesDir.getFileHandle(safeName, { create: false });
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

export async function deleteOPFSMedia(downloadId: string): Promise<void> {
  try {
    const root = await getOfflineRootDir();
    await root.removeEntry(downloadId, { recursive: true });
  } catch {
    // Directory might not exist or already deleted
  }
}
