import { mountBase } from "@/lib/router";
import type { BeforeInstallPromptEvent, InstallabilityState } from "../types";

export type InstallabilityListener = (state: InstallabilityState) => void;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<InstallabilityListener>();

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const isDisplayStandalone = window.matchMedia("(display-mode: standalone)").matches;
  const isIosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
  return isDisplayStandalone || isIosStandalone;
}

export function getInstallabilityState(): InstallabilityState {
  const installed = isStandalone();
  return {
    isInstallable: Boolean(deferredPrompt) && !installed,
    isInstalled: installed,
    canPrompt: Boolean(deferredPrompt),
  };
}

function notifyInstallListeners() {
  const state = getInstallabilityState();
  for (const listener of installListeners) {
    try {
      listener(state);
    } catch {
      // Ignore listener error
    }
  }
}

export function subscribeToInstallability(
  listener: InstallabilityListener
): () => void {
  installListeners.add(listener);
  listener(getInstallabilityState());
  return () => {
    installListeners.delete(listener);
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notifyInstallListeners();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyInstallListeners();
  });
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) {
    return "unavailable";
  }

  try {
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    deferredPrompt = null;
    notifyInstallListeners();
    return choice.outcome;
  } catch {
    deferredPrompt = null;
    notifyInstallListeners();
    return "unavailable";
  }
}

/**
 * Programmatically ensures that a <link rel="manifest"> is present in the document head.
 * Mount-aware, resolving to /manifest.webmanifest or /~/+/manifest.webmanifest.
 */
export function ensureManifestLink(href?: string): HTMLLinkElement | null {
  if (typeof document === "undefined") return null;

  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existing) {
    return existing;
  }

  const manifestUrl = href ?? `${mountBase()}manifest.webmanifest`;
  const link = document.createElement("link");
  link.rel = "manifest";
  link.href = manifestUrl;
  document.head.appendChild(link);
  return link;
}
