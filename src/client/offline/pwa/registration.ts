import { mountBase } from "@/lib/router";
import type { ServiceWorkerUpdateEvent } from "../types";

export type ServiceWorkerUpdateListener = (event: ServiceWorkerUpdateEvent) => void;

let activeRegistration: ServiceWorkerRegistration | null = null;
const updateListeners = new Set<ServiceWorkerUpdateListener>();

function notifyUpdate(event: ServiceWorkerUpdateEvent) {
  for (const listener of updateListeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeToServiceWorkerUpdates(
  listener: ServiceWorkerUpdateListener
): () => void {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

/**
 * Registers the Hawk service worker in a mount-aware fashion.
 * Works both at root "/" and behind Streamlit "/~/+/".
 */
export async function registerServiceWorker(options?: {
  swUrl?: string;
  scope?: string;
}): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  const base = mountBase();
  const swUrl = options?.swUrl ?? `${base}service-worker.js`;
  const scope = options?.scope ?? base;

  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope });
    activeRegistration = registration;

    // Detect if worker is already waiting
    if (registration.waiting) {
      notifyUpdate({ type: "waiting", registration });
    }

    registration.addEventListener("updatefound", () => {
      const installingWorker = registration.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener("statechange", () => {
        if (installingWorker.state === "installed") {
          if (navigator.serviceWorker.controller) {
            notifyUpdate({ type: "waiting", registration });
          } else {
            notifyUpdate({ type: "installed", registration });
          }
        } else if (installingWorker.state === "activated") {
          notifyUpdate({ type: "activated", registration });
        } else if (installingWorker.state === "redundant") {
          notifyUpdate({ type: "redundant", registration });
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      notifyUpdate({ type: "controlling", registration });
    });

    return registration;
  } catch {
    return null;
  }
}

export async function checkForUpdate(
  registration?: ServiceWorkerRegistration
): Promise<boolean> {
  const reg = registration || activeRegistration;
  if (!reg) return false;

  try {
    await reg.update();
    return Boolean(reg.waiting);
  } catch {
    return false;
  }
}

export async function applyUpdate(
  registration?: ServiceWorkerRegistration
): Promise<void> {
  const reg = registration || activeRegistration;
  if (!reg || !reg.waiting) return;

  reg.waiting.postMessage({ type: "SKIP_WAITING" });
}

export async function unregisterServiceWorker(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return false;
  }
  const reg = activeRegistration || (await navigator.serviceWorker.getRegistration());
  if (!reg) return false;
  const result = await reg.unregister();
  if (result) activeRegistration = null;
  return result;
}

export function getActiveRegistration(): ServiceWorkerRegistration | null {
  return activeRegistration;
}
