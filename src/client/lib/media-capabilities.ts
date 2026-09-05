import type { AudioCodec, ClientCapabilities } from "../../shared/playback"

const AUDIO_TYPES: Record<Exclude<AudioCodec, "unknown">, readonly string[]> = {
  aac: ['audio/mp4; codecs="mp4a.40.2"', 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"'],
  ac3: ['audio/mp4; codecs="ac-3"', 'video/mp4; codecs="avc1.42E01E, ac-3"'],
  eac3: ['audio/mp4; codecs="ec-3"', 'video/mp4; codecs="avc1.42E01E, ec-3"'],
  opus: ['audio/webm; codecs="opus"', 'video/webm; codecs="vp9, opus"'],
  mp3: ["audio/mpeg"],
}

let cached: ClientCapabilities | null = null

/** Ask this browser which common torrent audio formats it can decode. */
export function detectPlaybackCapabilities(): ClientCapabilities {
  if (cached) return cached
  if (typeof document === "undefined") return {}

  const audio = document.createElement("audio")
  const video = document.createElement("video")
  const supportedAudioCodecs: AudioCodec[] = []
  const unsupportedAudioCodecs: AudioCodec[] = []

  for (const [codec, contentTypes] of Object.entries(AUDIO_TYPES) as [Exclude<AudioCodec, "unknown">, readonly string[]][]) {
    const supported = contentTypes.some((contentType) => audio.canPlayType(contentType) !== "" || video.canPlayType(contentType) !== "")
    ;(supported ? supportedAudioCodecs : unsupportedAudioCodecs).push(codec)
  }

  cached = { supportedAudioCodecs, unsupportedAudioCodecs }
  return cached
}
