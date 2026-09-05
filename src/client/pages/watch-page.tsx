import type { MediaPlayerInstance } from "@vidstack/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { DownloadButton, useDownloads } from "@/components/downloads"
import { PageSkeleton } from "@/components/page-state"
import { PlayerStatus } from "@/components/player-status"
import { isBrowserCompatible, isContainerCompatible, PlayerPlaceholder, qualityLabel, VideoPlayer, type PlayerTrack, type QualityOption } from "@/components/video-player"
import { useCatalogEpisodes, useCatalogTitle, useLibrary, useNetworkStatus, usePlaybackProgress } from "@/hooks"
import { createPlayback, deletePlayback, errorMessage, fetchPlaybackSources, fetchPlaybackStatus, fetchSubtitles, isAbort, streamUrl } from "@/lib/api"
import { detectPlaybackCapabilities } from "@/lib/media-capabilities"
import { navigate, type WatchRoute } from "@/lib/router"
import { defaultDownloadManager, type DownloadManifest } from "@/offline"
import type { MediaDetails } from "../../shared/media"
import type { ClientCapabilities, MediaTarget, PlaybackSource, PlaybackStatus, SubtitleTrack, VideoQuality } from "../../shared/playback"

const QUALITY_RANK: Record<VideoQuality, number> = { "2160p": 5, "1440p": 4, "1080p": 3, "720p": 2, "480p": 1, unknown: 0 }

/**
 * The watch route is the player and nothing else: no app chrome, no document
 * scroll. Every control, status and error lives inside the player frame.
 */
export default function WatchPage({ route }: { route: WatchRoute }) {
  const imdbId = route.imdbId
  const season = typeof route.season === "number" ? route.season : null
  const episode = typeof route.episode === "number" ? route.episode : null
  const details = useCatalogTitle(imdbId)
  const episodes = useCatalogEpisodes(imdbId, season)
  const network = useNetworkStatus()
  const library = useLibrary()
  const progress = usePlaybackProgress(imdbId, details.data?.mediaType ?? (season === null ? "movie" : "tv"), season, episode)
  const manifests = useDownloads()
  const [sources, setSources] = useState<PlaybackSource[]>([])
  const [selected, setSelected] = useState<PlaybackSource | null>(null)
  const [status, setStatus] = useState<PlaybackStatus | null>(null)
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([])
  const [loadingSources, setLoadingSources] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [forceOffline, setForceOffline] = useState(false)
  const [offlineId] = useState(() => {
    if (typeof sessionStorage === "undefined") return null
    const id = sessionStorage.getItem("hawk.playOffline")
    sessionStorage.removeItem("hawk.playOffline")
    return id
  })
  const playerRef = useRef<MediaPlayerInstance>(null)
  const capabilities = useMemo(() => detectPlaybackCapabilities(), [])
  const currentTimeRef = useRef(0)
  const durationRef = useRef(0)
  const lastSavedRef = useRef(0)
  const failedSourcesRef = useRef(new Set<string>())
  const switchingSourceRef = useRef(false)
  /** Position and play intent carried across a source change. */
  const carryRef = useRef<{ time: number; play: boolean; volume: number; muted: boolean } | null>(null)
  const subtitleLangRef = useRef<string | null>(library.preferences.subtitlesEnabled ? library.preferences.subtitleLanguage : null)

  const downloadId = imdbId ? `${imdbId}${season !== null && episode !== null ? `-s${season}-e${episode}` : ""}` : ""
  const matchingDownload = manifests.find((item) => item.id === downloadId || item.id === offlineId)
  const offlineManifest = matchingDownload?.status === "completed" && (forceOffline || !network.isOnline || offlineId === matchingDownload.id) ? matchingDownload : null
  const episodeDetails = episodes.data?.results.find((item) => item.episode === episode)
  const target = useMemo<MediaTarget | null>(() => details.data && imdbId ? ({ imdbId, mediaType: details.data.mediaType, title: details.data.title, year: details.data.year, season, episode, episodeTitle: episodeDetails?.title ?? null }) : null, [details.data, episode, episodeDetails?.title, imdbId, season])

  const startSource = useCallback(async (source: PlaybackSource, targetMedia: MediaTarget, signal?: AbortSignal): Promise<boolean> => {
    setSelected(source); setStatus(null); setSubtitles([]); setError(null); setLoadingSources(true)
    try {
      const initial = await createPlayback({ target: targetMedia, sourceId: source.id, source }, signal)
      if (initial.container && initial.container !== "unknown" && !isContainerCompatible(initial.container)) {
        failedSourcesRef.current.add(source.id)
        await deletePlayback(initial.id).catch(() => undefined)
        setError(`The selected torrent contains ${initial.container.toUpperCase()} video, which this browser cannot play.`)
        setLoadingSources(false)
        return false
      }
      let tracks = initial.subtitles
      try { tracks = mergeTracks(initial.subtitles, await fetchSubtitles(initial.id, signal)) } catch (caught) { if (isAbort(caught)) return false }
      setSubtitles(tracks); setStatus(initial); setLoadingSources(false)
      return true
    } catch (caught) {
      if (isAbort(caught)) return false
      failedSourcesRef.current.add(source.id)
      setError(errorMessage(caught)); setLoadingSources(false)
      return false
    }
  }, [])

  /** User-initiated switch: keep the current position and whether we were playing, and start the torrent now. */
  const switchSource = useCallback((source: PlaybackSource) => {
    if (!target || source.id === selected?.id) return
    const player = playerRef.current
    carryRef.current = {
      time: player?.currentTime ?? currentTimeRef.current,
      play: player ? !player.paused : true,
      volume: player?.volume ?? 1,
      muted: player?.muted ?? false,
    }
    void startSource(source, target)
  }, [selected?.id, startSource, target])

  useEffect(() => {
    if (!target || offlineManifest || offlineId) return
    const controller = new AbortController()
    failedSourcesRef.current.clear()
    carryRef.current = null
    setLoadingSources(true); setError(null); setSources([]); setSelected(null); setStatus(null)
    void fetchPlaybackSources(target, controller.signal, capabilities).then(async (found) => {
      const ranked = [...found].sort((a, b) => b.score - a.score || b.seeders - a.seeders)
      setSources(ranked)
      let candidate = preferredSource(ranked, library.preferences.defaultQuality, capabilities)
      if (!candidate) { setLoadingSources(false); setError("No playable sources were found for this title."); return }
      for (let attempt = 0; attempt < 3 && candidate && !controller.signal.aborted; attempt += 1) {
        if (await startSource(candidate, target, controller.signal)) return
        candidate = fallbackSource(ranked, candidate, failedSourcesRef.current, capabilities)
      }
    }).catch((caught: unknown) => { if (!isAbort(caught)) { setError(errorMessage(caught)); setLoadingSources(false) } })
    return () => controller.abort()
  }, [capabilities, library.preferences.defaultQuality, nonce, offlineId, offlineManifest, startSource, target])

  useEffect(() => {
    const playbackId = status?.id
    if (!playbackId || offlineManifest || status.complete || status.state === "error") return
    let active = true
    let timer = 0
    const poll = async () => {
      try {
        const next = await fetchPlaybackStatus(playbackId)
        if (!active) return
        setStatus(next); setSubtitles((current) => mergeTracks(current, next.subtitles))
        if (!next.complete && next.state !== "error") timer = window.setTimeout(poll, 1500)
      } catch (caught) {
        if (active && !isAbort(caught)) { setError(errorMessage(caught)); timer = window.setTimeout(poll, 3000) }
      }
    }
    timer = window.setTimeout(poll, 1200)
    return () => { active = false; window.clearTimeout(timer) }
  }, [offlineManifest, status?.complete, status?.id, status?.state])

  if ((details.loading || (season !== null && episodes.loading)) && !offlineManifest) return <PageSkeleton variant="watch" />
  const backToLibrary = () => navigate({ name: "library" })
  if ((!details.data || details.error || !imdbId) && !offlineManifest) {
    return <div className="watch-route"><PlayerPlaceholder viewport title="Hawk" onBack={backToLibrary} notice={{ message: details.error ?? "This title could not be prepared.", onRetry: details.retry }} /></div>
  }
  if (!imdbId) return <div className="watch-route"><PlayerPlaceholder viewport title="Hawk" onBack={backToLibrary} notice={{ message: "This download has no media identifier." }} /></div>
  const media = details.data ?? offlineMediaDetails(offlineManifest!, imdbId)
  const episodeLabel = season !== null && episode !== null ? `S${season} E${episode}${episodeDetails?.title ? ` · ${episodeDetails.title}` : ""}` : null
  const displayTitle = offlineManifest?.title ?? (episodeLabel ? `${media.title} · ${episodeLabel}` : media.title)
  const onlineSource = status?.streamUrl ?? (status?.id && status.fileIndex !== null ? streamUrl(status.id, status.fileIndex) : null)
  const playerSource = offlineManifest ? defaultDownloadManager.getOfflineMediaUrl(offlineManifest.id) : onlineSource
  const rawTracks = offlineManifest ? offlineTracks(offlineManifest) : subtitles
  const defaultTrackId = subtitleLangRef.current ? rawTracks.find((track) => track.language === subtitleLangRef.current)?.id ?? null : null
  const playerTracks: PlayerTrack[] = rawTracks.map((track) => ({ id: track.id, src: track.url, type: track.format === "ass" ? "vtt" : track.format, label: subtitleOptionLabel(track, rawTracks), lang: track.language, default: track.id === defaultTrackId }))
  const qualityOptions = qualityChoices(sources, selected, capabilities)
  const backRoute = details.data ? { name: "title", id: imdbId, imdbId, type: media.mediaType } as const : { name: "library" } as const
  const goBack = () => navigate(backRoute)
  const switching = loadingSources && selected !== null && carryRef.current !== null

  const save = (position = currentTimeRef.current, duration = durationRef.current) => {
    if (!duration) return
    progress.saveProgress(position, duration)
    library.addHistory({ media, season, episode, positionSeconds: position, durationSeconds: duration, updatedAt: new Date().toISOString() })
  }
  const onCanPlay = (duration: number) => {
    switchingSourceRef.current = false
    durationRef.current = duration
    const player = playerRef.current
    if (!player) return
    const carried = carryRef.current
    carryRef.current = null
    if (carried) {
      player.volume = carried.volume
      player.muted = carried.muted
      if (carried.time > 1) player.currentTime = carried.time
      if (carried.play) requestPlayback(player)
      return
    }
    const resumeAt = progress.progress && library.preferences.autoResume && !progress.progress.completed ? progress.progress.positionSeconds : 0
    if (resumeAt > 5) player.currentTime = resumeAt
    if (library.preferences.autoplay) requestPlayback(player)
  }
  const onTimeUpdate = (currentTime: number, duration: number) => {
    currentTimeRef.current = currentTime
    if (duration) durationRef.current = duration
    if (Date.now() - lastSavedRef.current > 5000) { lastSavedRef.current = Date.now(); save(currentTime) }
  }
  const onPlayerError = () => {
    if (!selected || !target || switchingSourceRef.current) return
    failedSourcesRef.current.add(selected.id)
    const fallback = fallbackSource(sources, selected, failedSourcesRef.current, capabilities)
    if (fallback) {
      switchingSourceRef.current = true
      carryRef.current = {
        time: currentTimeRef.current,
        play: true,
        volume: playerRef.current?.volume ?? 1,
        muted: playerRef.current?.muted ?? false,
      }
      void startSource(fallback, target).then((started) => {
        if (started) return
        const next = fallbackSource(sources, fallback, failedSourcesRef.current, capabilities)
        if (next) return startSource(next, target)
      }).finally(() => { switchingSourceRef.current = false })
      return
    }
    setError("This source uses a video format your browser cannot play. Choose another source.")
  }
  const downloadOptions = { id: downloadId, title: displayTitle, mediaType: media.mediaType, year: media.year, mediaUrl: onlineSource ?? "", totalBytes: status?.totalBytes, subtitles: subtitles.slice(0, 3).map((track) => ({ id: track.id, label: track.label, language: track.language, url: track.url, format: track.format })), posterUrl: media.posterUrl, backdropUrl: media.backdropUrl, metadata: { imdbId, season, episode } }
  const notice = error ? { message: error, onRetry: () => { setError(null); setNonce((value) => value + 1) } } : null
  const statusLine = <PlayerStatus status={status} offline={Boolean(offlineManifest)} switching={switching} />
  const sourceLine = offlineManifest ? "Offline copy" : selected ? `${qualityLabel(selected.quality)}${selected.container !== "unknown" ? ` · ${selected.container.toUpperCase()}` : ""}${audioLabel(selected) ? ` · ${audioLabel(selected)}` : ""}` : null

  return (
    <div className="watch-route animate-fade">
      {playerSource ? (
        <VideoPlayer
          key={playerSource}
          viewport
          playerRef={playerRef}
          src={playerSource}
          mimeType={offlineManifest?.mimeType === "video/mp4" || offlineManifest?.mimeType === "video/webm" ? offlineManifest.mimeType : selected?.container === "mp4" ? "video/mp4" : selected?.container === "webm" ? "video/webm" : undefined}
          title={media.title}
          subtitle={episodeLabel ?? sourceLine}
          poster={media.backdropUrl}
          tracks={playerTracks}
          qualities={qualityOptions}
          activeQuality={selected?.id ?? null}
          onSelectQuality={(id) => { const source = sources.find((item) => item.id === id); if (source) switchSource(source) }}
          sources={offlineManifest ? [] : sources}
          onSelectSource={switchSource}
          onBack={goBack}
          autoPlay={library.preferences.autoplay}
          status={statusLine}
          actions={onlineSource ? <DownloadButton chrome options={downloadOptions} manifest={matchingDownload} onError={setError} onPlay={() => setForceOffline(true)} /> : null}
          notice={notice}
          onCanPlay={onCanPlay}
          onTimeUpdate={onTimeUpdate}
          onPause={(time, duration) => save(time, duration || durationRef.current)}
          onEnded={(duration) => save(duration || durationRef.current, duration || durationRef.current)}
          onError={onPlayerError}
        />
      ) : (
        <PlayerPlaceholder
          viewport
          title={media.title}
          subtitle={[episodeLabel, sourceLine].filter(Boolean).join(" · ") || null}
          onBack={goBack}
          notice={notice}
          loading={switching ? "Switching source" : loadingSources ? "Preparing the best available source" : "Waiting for a playable stream"}
        />
      )}
    </div>
  )
}

function requestPlayback(player: MediaPlayerInstance): void {
  void player.play().catch(() => {
    player.muted = true
    void player.play().catch(() => undefined)
  })
}

/**
 * One option per resolution, preferring browser-compatible containers. The
 * active source is always listed so the label reflects what is really playing.
 */
function qualityChoices(sources: PlaybackSource[], selected: PlaybackSource | null, capabilities: ClientCapabilities): QualityOption[] {
  const byQuality = new Map<VideoQuality, PlaybackSource>()
  if (selected) byQuality.set(selected.quality, selected)
  for (const source of sources) {
    const current = byQuality.get(source.quality)
    if (!current || compatibilityRank(source, capabilities) > compatibilityRank(current, capabilities)) byQuality.set(source.quality, source)
  }
  return Array.from(byQuality.values())
    .sort((a, b) => QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality])
    .map((source) => ({ id: source.id, label: source.quality === "unknown" ? "Unknown" : source.quality, detail: [source.container !== "unknown" ? source.container.toUpperCase() : null, audioLabel(source)].filter(Boolean).join(" · ") || undefined }))
}

function mergeTracks(...sets: SubtitleTrack[][]): SubtitleTrack[] {
  return Array.from(new Map(sets.flat().map((track) => [track.id || track.url, track])).values())
}

function offlineTracks(manifest: DownloadManifest): SubtitleTrack[] {
  return manifest.subtitles.filter((track) => track.downloaded).map((track) => ({ id: track.id, label: track.label, language: track.language, source: "offline", format: track.format === "srt" ? "srt" : "vtt", url: defaultDownloadManager.getOfflineSubtitleUrl(manifest.id, track.id), hearingImpaired: false }))
}

function offlineMediaDetails(manifest: DownloadManifest, imdbId: string): MediaDetails {
  return {
    id: imdbId,
    imdbId,
    tmdbId: null,
    mediaType: manifest.mediaType,
    title: manifest.title,
    originalTitle: null,
    year: manifest.year ?? null,
    endYear: null,
    rating: null,
    voteCount: null,
    genres: [],
    posterUrl: manifest.artwork.downloadedPoster ? defaultDownloadManager.getOfflineArtworkUrl(manifest.id) : null,
    backdropUrl: manifest.artwork.downloadedBackdrop ? defaultDownloadManager.getOfflineArtworkUrl(manifest.id, "backdrop") : null,
    overview: null,
    runtimeMinutes: null,
    releaseDate: null,
    certification: null,
    metacriticScore: null,
    countries: [],
    languages: [],
    cast: [],
    trailer: null,
    similar: [],
    seasons: [],
  }
}

function preferredSource(sources: PlaybackSource[], quality: VideoQuality, capabilities: ClientCapabilities): PlaybackSource | undefined {
  if (quality === "unknown") return bestSource(sources, capabilities)
  const exact = sources.filter((source) => source.quality === quality)
  if (exact.length) return bestSource(exact, capabilities)
  const targetRank = QUALITY_RANK[quality]
  const lower = sources.filter((source) => QUALITY_RANK[source.quality] <= targetRank)
  const nextQuality = [...new Set(lower.map((source) => source.quality))].sort((a, b) => QUALITY_RANK[b] - QUALITY_RANK[a])[0]
  return bestSource(lower.filter((source) => source.quality === nextQuality), capabilities) ?? bestSource(sources, capabilities)
}

function bestSource(sources: PlaybackSource[], capabilities: ClientCapabilities): PlaybackSource | undefined {
  return sources.reduce<PlaybackSource | undefined>((best, source) => {
    if (!best) return source
    const sourceRank = compatibilityRank(source, capabilities)
    const bestRank = compatibilityRank(best, capabilities)
    return sourceRank > bestRank || (sourceRank === bestRank && source.score > best.score) ? source : best
  }, undefined)
}

function fallbackSource(sources: PlaybackSource[], failed: PlaybackSource, excluded: Set<string>, capabilities: ClientCapabilities): PlaybackSource | undefined {
  const remaining = sources.filter((source) => !excluded.has(source.id))
  const knownBrowserSources = remaining.filter(isBrowserCompatible)
  if (knownBrowserSources.length) return bestSource(knownBrowserSources, capabilities)
  return preferredSource(remaining, failed.quality, capabilities)
}

function compatibilityRank(source: PlaybackSource, capabilities: ClientCapabilities): number {
  const audio = source.audioCodec
  const unsupportedAudio = audio && audio !== "unknown" && capabilities.unsupportedAudioCodecs?.includes(audio)
  const supportedAudio = audio && audio !== "unknown" && capabilities.supportedAudioCodecs?.includes(audio)
  if (unsupportedAudio) return 0
  if (isBrowserCompatible(source) && supportedAudio) return 4
  if (supportedAudio) return 3
  if (isBrowserCompatible(source)) return 2
  return 1
}

function audioLabel(source: PlaybackSource): string | null {
  if (!source.audioCodec || source.audioCodec === "unknown") return null
  if (source.audioCodec === "eac3") return "EAC3"
  if (source.audioCodec === "ac3") return "AC3"
  return source.audioCodec.toUpperCase()
}

function subtitleOptionLabel(track: SubtitleTrack, tracks: SubtitleTrack[]): string {
  let language = track.label
  try {
    language = new Intl.DisplayNames(["en"], { type: "language" }).of(track.language) ?? track.label
  } catch {
    // Keep the provider label for non-standard language codes.
  }
  const matches = tracks.filter((item) => item.language === track.language)
  const position = matches.findIndex((item) => item.id === track.id)
  const variant = matches.length > 1 ? ` ${position + 1}` : ""
  return `${language}${variant} · ${track.source}`
}
