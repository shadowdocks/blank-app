import type { StorageInspection } from "../types";
import { isOPFSSupported } from "./opfs";

export async function inspectStorage(): Promise<StorageInspection> {
  let quota = 0;
  let usage = 0;
  let isPersistent = false;

  if (typeof navigator !== "undefined" && navigator.storage) {
    if (typeof navigator.storage.estimate === "function") {
      try {
        const estimate = await navigator.storage.estimate();
        quota = estimate.quota ?? 0;
        usage = estimate.usage ?? 0;
      } catch {
        // Fallback default
      }
    }

    if (typeof navigator.storage.persisted === "function") {
      try {
        isPersistent = await navigator.storage.persisted();
      } catch {
        // Fallback default
      }
    }
  }

  const available = Math.max(0, quota - usage);
  const percentUsed = quota > 0 ? Math.min(100, Math.round((usage / quota) * 1000) / 10) : 0;
  const supportsOPFS = await isOPFSSupported();
  const supportsIDB = typeof indexedDB !== "undefined";

  return {
    quota,
    usage,
    available,
    percentUsed,
    isPersistent,
    supportsOPFS,
    supportsIDB,
  };
}

export async function requestPersistence(): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.storage &&
    typeof navigator.storage.persist === "function"
  ) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export async function checkStorageAvailability(
  requiredBytes: number
): Promise<{ ok: boolean; reason?: string }> {
  const inspection = await inspectStorage();

  if (!inspection.supportsIDB && !inspection.supportsOPFS) {
    return {
      ok: false,
      reason: "Offline storage is not supported in this browser environment.",
    };
  }

  if (inspection.quota > 0 && inspection.available < requiredBytes) {
    return {
      ok: false,
      reason: `Insufficient storage space: requires ${formatBytes(requiredBytes)}, but only ${formatBytes(inspection.available)} available.`,
    };
  }

  return { ok: true };
}
