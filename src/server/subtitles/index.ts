import type { SubtitleTrack } from "../../shared/playback";

export * from "./converter";
export * from "./adapter";
export * from "./proxy";

export function normalizeTracks(
  torrentSidecars: SubtitleTrack[] = [],
  externalTracks: SubtitleTrack[] = [],
): SubtitleTrack[] {
  const seenIds = new Set<string>();
  const combined: SubtitleTrack[] = [];

  for (const track of torrentSidecars) {
    if (!seenIds.has(track.id)) {
      seenIds.add(track.id);
      combined.push(track);
    }
  }

  for (const track of externalTracks) {
    if (!seenIds.has(track.id)) {
      seenIds.add(track.id);
      combined.push(track);
    }
  }

  // Deterministic sort: English first, then alphabetical by language, torrent tracks before external
  return combined.sort((a, b) => {
    if (a.language === "en" && b.language !== "en") return -1;
    if (b.language === "en" && a.language !== "en") return 1;

    const langCmp = a.language.localeCompare(b.language);
    if (langCmp !== 0) return langCmp;

    if (a.source === "torrent" && b.source !== "torrent") return -1;
    if (b.source === "torrent" && a.source !== "torrent") return 1;

    return a.label.localeCompare(b.label);
  });
}
