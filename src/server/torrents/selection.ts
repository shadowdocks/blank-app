import type { MediaType } from "../../shared/media";
import type { SubtitleTrack } from "../../shared/playback";
import type { RqbitFile } from "./types";

export const VIDEO_PATTERN = /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i;
export const SUBTITLE_PATTERN = /\.(vtt|srt|ass)$/i;
export const SELECTED_FILE_PATTERN = String.raw`(?i)\.(mp4|m4v|mkv|webm|mov|avi|ts|vtt|srt|ass)$`;

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mkv: "video/x-matroska",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  ts: "video/mp2t",
  vtt: "text/vtt",
  srt: "application/x-subrip",
  ass: "text/x-ssa",
};

const BROWSER_VIDEO_PATTERN = /\.(mp4|m4v|webm)$/i;

function preferredVideo<T extends { file: RqbitFile; index: number }>(candidates: T[]): number {
  const browserReady = candidates.filter(({ file }) => BROWSER_VIDEO_PATTERN.test(file.name));
  const pool = browserReady.length > 0 ? browserReady : candidates;
  return pool.reduce((max, curr) => (curr.file.length > max.file.length ? curr : max)).index;
}

export function mime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  return MIME_TYPES[ext ?? ""] ?? "application/octet-stream";
}

export function normalizedRange(value: string | null, length: number): string | null {
  if (!value) return null;
  const suffix = /^bytes=-(\d+)$/.exec(value);
  if (!suffix) return value;
  const size = Number(suffix[1]);
  if (!Number.isSafeInteger(size) || size <= 0) return value;
  return `bytes=${Math.max(0, length - size)}-${length - 1}`;
}

export function parseByteRange(
  range: string | null,
  fileLength: number,
): { start: number; end: number; isValid: boolean } | null {
  if (!range) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return { start: 0, end: 0, isValid: false };

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileLength - 1;
  const end = Math.min(requestedEnd, fileLength - 1);

  const isValid =
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(requestedEnd) &&
    start >= 0 &&
    start < fileLength &&
    start <= end;

  return { start, end, isValid };
}

function matchesEpisode(
  filename: string,
  season: number,
  episode: number,
): boolean {
  const clean = filename.toLowerCase();

  // Pattern: s01e02, s1e2, s01.e02, s01_e02
  const seMatch = /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i.exec(clean);
  if (seMatch) {
    return Number.parseInt(seMatch[1], 10) === season && Number.parseInt(seMatch[2], 10) === episode;
  }

  // Pattern: 1x02, 01x02
  const xMatch = /\b(\d{1,2})x(\d{1,3})\b/i.exec(clean);
  if (xMatch) {
    return Number.parseInt(xMatch[1], 10) === season && Number.parseInt(xMatch[2], 10) === episode;
  }

  // Pattern: Episode 2 or Ep 2 if season is 1 or path has season
  const epMatch = /\b(?:e|ep|episode)[\s._-]*0*(\d{1,3})\b/i.exec(clean);
  if (epMatch && Number.parseInt(epMatch[1], 10) === episode) {
    const seasonInPath = /\b(?:s|season)[\s._-]*0*(\d{1,2})\b/i.exec(clean);
    if (!seasonInPath || Number.parseInt(seasonInPath[1], 10) === season) {
      return true;
    }
  }

  return false;
}

export function selectPlayableFile(
  files: RqbitFile[],
  mediaType: MediaType = "movie",
  season: number | null = null,
  episode: number | null = null,
): number | null {
  if (!files || files.length === 0) return null;

  const videoCandidates = files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.included && VIDEO_PATTERN.test(file.name));

  if (videoCandidates.length === 0) {
    // If none marked included, check all video files
    const allVideos = files
      .map((file, index) => ({ file, index }))
      .filter(({ file }) => VIDEO_PATTERN.test(file.name));
    if (allVideos.length === 0) return null;
    return preferredVideo(allVideos);
  }

  // TV Episode selection
  if (mediaType === "tv" && typeof season === "number" && typeof episode === "number") {
    const episodeMatches = videoCandidates.filter(({ file }) =>
      matchesEpisode(file.name, season, episode),
    );

    if (episodeMatches.length > 0) {
      // Pick largest matching episode file (skips samples)
      const nonSamples = episodeMatches.filter(({ file }) => !/\bsample\b/i.test(file.name));
      const candidates = nonSamples.length > 0 ? nonSamples : episodeMatches;
      return preferredVideo(candidates);
    }
  }

  // Movie or fallback: largest non-sample video
  const nonSamples = videoCandidates.filter(({ file }) => !/\bsample\b/i.test(file.name));
  const pool = nonSamples.length > 0 ? nonSamples : videoCandidates;
  return preferredVideo(pool);
}

const LANGUAGE_MAP: Record<string, { label: string; code: string }> = {
  en: { label: "English", code: "en" },
  eng: { label: "English", code: "en" },
  english: { label: "English", code: "en" },
  es: { label: "Spanish", code: "es" },
  spa: { label: "Spanish", code: "es" },
  spanish: { label: "Spanish", code: "es" },
  fr: { label: "French", code: "fr" },
  fre: { label: "French", code: "fr" },
  fra: { label: "French", code: "fr" },
  french: { label: "French", code: "fr" },
  de: { label: "German", code: "de" },
  ger: { label: "German", code: "de" },
  deu: { label: "German", code: "de" },
  german: { label: "German", code: "de" },
  it: { label: "Italian", code: "it" },
  ita: { label: "Italian", code: "it" },
  italian: { label: "Italian", code: "it" },
  pt: { label: "Portuguese", code: "pt" },
  por: { label: "Portuguese", code: "pt" },
  portuguese: { label: "Portuguese", code: "pt" },
  ru: { label: "Russian", code: "ru" },
  rus: { label: "Russian", code: "ru" },
  russian: { label: "Russian", code: "ru" },
  zh: { label: "Chinese", code: "zh" },
  chi: { label: "Chinese", code: "zh" },
  zho: { label: "Chinese", code: "zh" },
  chinese: { label: "Chinese", code: "zh" },
  ja: { label: "Japanese", code: "ja" },
  jpn: { label: "Japanese", code: "ja" },
  japanese: { label: "Japanese", code: "ja" },
  ko: { label: "Korean", code: "ko" },
  kor: { label: "Korean", code: "ko" },
  korean: { label: "Korean", code: "ko" },
  ar: { label: "Arabic", code: "ar" },
  ara: { label: "Arabic", code: "ar" },
  arabic: { label: "Arabic", code: "ar" },
  hi: { label: "Hindi", code: "hi" },
  hin: { label: "Hindi", code: "hi" },
  da: { label: "Danish", code: "da" },
  dan: { label: "Danish", code: "da" },
  danish: { label: "Danish", code: "da" },
  nl: { label: "Dutch", code: "nl" },
  dut: { label: "Dutch", code: "nl" },
  nla: { label: "Dutch", code: "nl" },
  sv: { label: "Swedish", code: "sv" },
  swe: { label: "Swedish", code: "sv" },
  no: { label: "Norwegian", code: "no" },
  nor: { label: "Norwegian", code: "no" },
  pl: { label: "Polish", code: "pl" },
  pol: { label: "Polish", code: "pl" },
  tr: { label: "Turkish", code: "tr" },
  tur: { label: "Turkish", code: "tr" },
};

export function selectSidecarSubtitles(
  files: RqbitFile[],
  hash: string,
  baseUrl = "",
): SubtitleTrack[] {
  if (!files || files.length === 0) return [];

  const normalizedHash = hash.toLowerCase();
  const tracks: SubtitleTrack[] = [];

  files.forEach((file, index) => {
    if (!SUBTITLE_PATTERN.test(file.name) || !file.included) return;

    const filename = file.name.split("/").pop() ?? file.name;
    const tokens = filename.toLowerCase().replace(/\.(vtt|srt|ass)$/, "").split(/[^a-z0-9]+/).filter(Boolean);

    let langInfo: { label: string; code: string } | undefined;
    for (const token of tokens) {
      if (LANGUAGE_MAP[token]) {
        langInfo = LANGUAGE_MAP[token];
        break;
      }
    }

    const hearingImpaired = tokens.some((token) => token === "hi" || token === "sdh" || token === "cc");
    const label = langInfo
      ? `${langInfo.label}${hearingImpaired ? " (SDH)" : ""}`
      : filename.replace(/\.(vtt|srt|ass)$/i, "").replace(/[._-]+/g, " ").trim() || `Subtitle ${index + 1}`;

    tracks.push({
      id: `torrent-${normalizedHash}-${index}`,
      label,
      language: langInfo?.code ?? "unknown",
      source: "torrent",
      format: "vtt",
      url: `${baseUrl}/api/torrents/${encodeURIComponent(normalizedHash)}/subtitles/${index}`,
      hearingImpaired,
    });
  });

  return tracks;
}
