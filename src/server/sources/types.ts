import type { MediaType } from "../../shared/media";
import type { MediaTarget, PlaybackSource, VideoContainer, VideoQuality } from "../../shared/playback";

export type { MediaType, MediaTarget, PlaybackSource, VideoContainer, VideoQuality };

export type ProviderHealthStatus = "ok" | "timeout" | "http_error" | "invalid_shape";

export interface ProviderHealth {
  provider: "torrentio" | "apibay";
  status: ProviderHealthStatus;
  statusCode: number | null;
  durationMs: number;
  error: string | null;
}

export const DEFAULT_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
];

export const TRACKER_QUERY_STRING = DEFAULT_TRACKERS
  .map((tracker) => `&tr=${encodeURIComponent(tracker)}`)
  .join("");

export function createMagnetUri(infoHash: string, name: string): string {
  const normalizedHash = infoHash.toUpperCase();
  return `magnet:?xt=urn:btih:${normalizedHash}&dn=${encodeURIComponent(name)}${TRACKER_QUERY_STRING}`;
}
