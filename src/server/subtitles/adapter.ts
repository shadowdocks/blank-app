import type { MediaTarget, SubtitleTrack } from "../../shared/playback";

export interface OpenSubtitlesOptions {
  baseUrl?: string;
  timeoutMs?: number;
  proxyPrefix?: string;
  signal?: AbortSignal;
}

const LANGUAGE_NAMES: Record<string, string> = {
  ar: "Arabic", da: "Danish", de: "German", en: "English", es: "Spanish",
  fi: "Finnish", fr: "French", hi: "Hindi", it: "Italian", ja: "Japanese",
  ko: "Korean", nl: "Dutch", no: "Norwegian", pl: "Polish", pt: "Portuguese",
  ru: "Russian", sv: "Swedish", tr: "Turkish", zh: "Chinese",
};

interface StremioSubtitleResponse {
  subtitles?: Array<{ id?: string; url?: string; lang?: string }>;
}

export async function fetchOpenSubtitles(
  target: MediaTarget,
  options: OpenSubtitlesOptions = {},
): Promise<SubtitleTrack[]> {
  if (!/^tt\d{7,10}$/.test(target.imdbId)) return [];

  const baseUrl = (options.baseUrl ?? process.env.OPENSUBTITLES_URL ?? "https://opensubtitles-v3.strem.io")
    .replace(/\/+$/, "");
  const type = target.mediaType === "tv" ? "series" : "movie";
  const id = target.mediaType === "tv"
    ? `${target.imdbId}:${target.season ?? 1}:${target.episode ?? 1}`
    : target.imdbId;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(`${baseUrl}/subtitles/${type}/${id}.json`, {
      headers: { accept: "application/json", "user-agent": "hawk/2.0" },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    const body = await response.json() as StremioSubtitleResponse;
    if (!Array.isArray(body.subtitles)) return [];
    const proxyPrefix = options.proxyPrefix ?? "/api/subtitles/proxy";

    return body.subtitles.flatMap((subtitle, index) => {
      if (!subtitle.url || !/^https?:\/\//.test(subtitle.url)) return [];
      const language = subtitle.lang?.toLowerCase() || "und";
      return [{
        id: `opensubtitles-${subtitle.id || index}`,
        label: LANGUAGE_NAMES[language] ?? language.toUpperCase(),
        language,
        source: "opensubtitles",
        format: "vtt" as const,
        url: `${proxyPrefix}?url=${encodeURIComponent(subtitle.url)}`,
        hearingImpaired: false,
      }];
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}
