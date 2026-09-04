export * from "./types";
export * from "./errors";
export * from "./range";
export * from "./manifest";

export {
  openOfflineDatabase,
  saveManifest,
  getManifest,
  getAllManifests,
  deleteManifest,
  saveChunk,
  getChunk,
  getChunksInRange,
  deleteChunksForDownload,
  saveStoredFile,
  getStoredFile,
  deleteFilesForDownload,
  clearAllOfflineStorage,
} from "./storage/idb";

export {
  isOPFSSupported,
  writeOPFSChunk,
  readOPFSRange,
  getOPFSMediaFile,
  saveOPFSAuxFile,
  readOPFSAuxFile,
  deleteOPFSMedia,
} from "./storage/opfs";

export {
  inspectStorage,
  requestPersistence,
  checkStorageAvailability,
  formatBytes,
} from "./storage/quota";

export {
  OfflineStorageAdapter,
  defaultStorageAdapter,
} from "./storage/adapter";

export {
  DownloadManager,
  defaultDownloadManager,
  type DownloadListener,
} from "./download/download-manager";

export {
  registerServiceWorker,
  checkForUpdate,
  applyUpdate,
  unregisterServiceWorker,
  subscribeToServiceWorkerUpdates,
  getActiveRegistration,
  type ServiceWorkerUpdateListener,
} from "./pwa/registration";

export {
  isStandalone,
  getInstallabilityState,
  subscribeToInstallability,
  promptInstall,
  ensureManifestLink,
  type InstallabilityListener,
} from "./pwa/install";
