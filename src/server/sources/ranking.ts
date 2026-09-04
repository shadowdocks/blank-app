import type { MediaTarget, PlaybackSource, VideoContainer, VideoQuality } from "./types";

export interface ParsedReleaseDetails {
  quality: VideoQuality;
  codec: string | null;
  hdr: string | null;
  isBadRelease: boolean;
  badReleaseReason?: string;
  season?: number;
  episode?: number;
  year?: number;
}

export function parseQuality(text: string): VideoQuality {
  if (/\b(2160p|4k|uhd)\b/i.test(text)) return "2160p";
  if (/\b(1440p|2k)\b/i.test(text)) return "1440p";
  if (/\b(1080p|fhd)\b/i.test(text)) return "1080p";
  if (/\b(720p|hd)\b/i.test(text)) return "720p";
  if (/\b(480p|576p|sd)\b/i.test(text)) return "480p";
  return "unknown";
}

export function parseContainer(text: string): VideoContainer {
  const match = /\.(mp4|webm|mkv|avi|mov|m4v|ts)(?:\b|$)/i.exec(text);
  if (!match) return "unknown";
  if (match[1].toLowerCase() === "m4v") return "mp4";
  return match[1].toLowerCase() as VideoContainer;
}

export function parseCodec(text: string): string | null {
  if (/\b(av1)\b/i.test(text)) return "AV1";
  if (/\b(hevc|h[._-]?265|x265)\b/i.test(text)) return "HEVC";
  if (/\b(avc|h[._-]?264|x264)\b/i.test(text)) return "AVC";
  if (/\b(xvid|divx)\b/i.test(text)) return "XviD";
  if (/\b(mpeg2)\b/i.test(text)) return "MPEG2";
  return null;
}

export function parseHdr(text: string): string | null {
  if (/\b(dv|dovi|dolby[\s._-]?vision)\b/i.test(text)) return "DV";
  if (/(?:^|[^a-z0-9])(hdr10\+|hdr10plus)(?:[^a-z0-9]|$)/i.test(text)) return "HDR10+";
  if (/\b(hdr10)\b/i.test(text)) return "HDR10";
  if (/\b(hdr)\b/i.test(text)) return "HDR";
  return null;
}

export function checkBadRelease(text: string): { isBad: boolean; reason?: string } {
  if (/\b(cam|hdcam|ts|telesync|hdts|hd-ts|screener|scr|dvdscr|workprint|wp|telecine|tc)\b/i.test(text)) {
    return { isBad: true, reason: "cam_or_screener" };
  }
  if (/\b(sample)\b/i.test(text)) {
    return { isBad: true, reason: "sample" };
  }
  if (/\.(rar|zip|7z|tar|iso)$/i.test(text) || /\b(rar|zip)\b/i.test(text)) {
    return { isBad: true, reason: "archive" };
  }
  return { isBad: false };
}

export function parseSeasonEpisode(text: string): { season?: number; episode?: number } {
  const seMatch = /\bs(\d{1,2})[\s._-]*e(\d{1,3})\b/i.exec(text);
  if (seMatch) {
    return { season: Number.parseInt(seMatch[1], 10), episode: Number.parseInt(seMatch[2], 10) };
  }

  const xMatch = /\b(\d{1,2})x(\d{1,3})\b/i.exec(text);
  if (xMatch) {
    return { season: Number.parseInt(xMatch[1], 10), episode: Number.parseInt(xMatch[2], 10) };
  }

  const seasonOnlyMatch = /\b(?:s|season)[\s._-]*(\d{1,2})\b/i.exec(text);
  const epOnlyMatch = /\b(?:e|ep|episode)[\s._-]*(\d{1,3})\b/i.exec(text);

  return {
    season: seasonOnlyMatch ? Number.parseInt(seasonOnlyMatch[1], 10) : undefined,
    episode: epOnlyMatch ? Number.parseInt(epOnlyMatch[1], 10) : undefined,
  };
}

export function parseYear(text: string): number | undefined {
  const matches = text.match(/\b(19\d\d|20\d\d)\b/g);
  if (!matches) return undefined;
  const last = matches[matches.length - 1];
  return Number.parseInt(last, 10);
}

export function parseReleaseDetails(text: string): ParsedReleaseDetails {
  const quality = parseQuality(text);
  const codec = parseCodec(text);
  const hdr = parseHdr(text);
  const bad = checkBadRelease(text);
  const se = parseSeasonEpisode(text);
  const year = parseYear(text);

  return {
    quality,
    codec,
    hdr,
    isBadRelease: bad.isBad,
    badReleaseReason: bad.reason,
    season: se.season,
    episode: se.episode,
    year,
  };
}

export function computeScore(source: Omit<PlaybackSource, "score">, target: MediaTarget): number {
  let score = 100;
  const combinedText = `${source.name} ${source.provider}`;
  const details = parseReleaseDetails(combinedText);

  // 1. Media Type & Episode/Season Matching
  if (target.mediaType === "tv") {
    const targetSeason = target.season ?? 1;
    const targetEpisode = target.episode ?? 1;

    if (details.season !== undefined && details.episode !== undefined) {
      if (details.season === targetSeason && details.episode === targetEpisode) {
        score += 500; // Exact season & episode match
      } else if (details.season === targetSeason && details.episode !== targetEpisode) {
        score -= 800; // Wrong episode in right season
      } else {
        score -= 900; // Wrong season altogether
      }
    } else if (details.season !== undefined && details.episode === undefined) {
      if (details.season === targetSeason) {
        score += 250; // Season pack
      } else {
        score -= 900; // Wrong season pack
      }
    } else if (details.episode !== undefined && details.season === undefined) {
      if (details.episode === targetEpisode) {
        score += 150;
      } else {
        score -= 700;
      }
    }
  } else {
    // Movie target
    if (details.season !== undefined || details.episode !== undefined) {
      score -= 600; // TV series release for a movie
    } else if (target.year && details.year) {
      const diff = Math.abs(details.year - target.year);
      if (diff === 0) {
        score += 100;
      } else if (diff > 1) {
        score -= 200;
      }
    }
  }

  // 2. Quality
  switch (source.quality) {
    case "1080p":
      score += 280;
      break;
    case "2160p":
      score += 260;
      break;
    case "1440p":
      score += 200;
      break;
    case "720p":
      score += 140;
      break;
    case "480p":
      score += 40;
      break;
    case "unknown":
      score += 0;
      break;
  }

  // 3. Codec
  if (source.codec === "AV1") score += 60;
  else if (source.codec === "HEVC") score += 50;
  else if (source.codec === "AVC") score += 40;
  else if (source.codec === "XviD" || source.codec === "MPEG2") score -= 80;

  // Browser playback requires a web-native container. Prefer the broadly
  // supported MP4/AVC combination before seed count or raw resolution.
  if (source.container === "mp4") score += 1_200;
  else if (source.container === "webm") score += 700;
  else if (source.container === "mkv") score -= 1_200;
  else if (source.container === "avi" || source.container === "ts") score -= 1_300;
  else if (source.container === "mov") score -= 400;
  else score -= 300;

  if (source.container === "mp4" && source.codec === "AVC") score += 200;

  // 4. HDR
  if (source.hdr === "DV") score += 40;
  else if (source.hdr === "HDR10+") score += 35;
  else if (source.hdr === "HDR10" || source.hdr === "HDR") score += 25;

  // 5. Seeders
  if (source.seeders <= 0) {
    score -= 300;
  } else {
    score += Math.min(Math.round(Math.log2(source.seeders + 1) * 35), 300);
    if (source.seeders >= 40) score += 40;
  }

  // 6. Size
  if (source.sizeBytes && source.sizeBytes > 0) {
    const sizeGb = source.sizeBytes / 1e9;
    if (target.mediaType === "movie") {
      if (sizeGb < 0.3) {
        score -= 500; // Likely a fake or sample
      } else if (sizeGb >= 0.8 && sizeGb <= 12) {
        score += 120; // Ideal streaming range
      } else if (sizeGb > 12 && sizeGb <= 30) {
        score += 70;
      } else if (sizeGb > 55) {
        score -= 80; // Very large file
      }
    } else {
      // TV
      if (sizeGb < 0.08) {
        score -= 400;
      } else if (sizeGb >= 0.2 && sizeGb <= 3.5) {
        score += 120; // Ideal TV episode size
      } else if (sizeGb > 15 && details.season !== undefined && details.episode === undefined) {
        score += 80; // Season pack size
      } else if (sizeGb > 12 && details.episode !== undefined) {
        score -= 80; // Extremely large single episode
      }
    }
  }

  // 7. Bad Release Penalties
  if (details.isBadRelease) {
    if (details.badReleaseReason === "cam_or_screener") score -= 1000;
    else if (details.badReleaseReason === "sample") score -= 800;
    else if (details.badReleaseReason === "archive") score -= 600;
    else score -= 500;
  }

  return score;
}

export function rankSources(sources: PlaybackSource[], target: MediaTarget): PlaybackSource[] {
  const scored = sources.map((source) => ({
    ...source,
    score: computeScore(source, target),
  }));

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.seeders !== a.seeders) return b.seeders - a.seeders;
    return a.infoHash.localeCompare(b.infoHash);
  });
}
