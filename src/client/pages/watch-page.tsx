import { MediaPlayer, MediaProvider, Track, type MediaPlayerInstance } from "@vidstack/react"
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default"
import "@vidstack/react/player/styles/default/theme.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import { Check, ChevronLeft, ListVideo, Loader2, Maximize, Play, RotateCcw, Subtitles, WifiOff, X } from "lucide-react"
import { Dialog } from "radix-ui"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppLink } from "@/components/app-link"
import { DownloadButton, useDownloads } from "@/components/downloads"
import { ErrorState, PageContainer, PageSkeleton } from "@/components/page-state"
import { PlayerStatus } from "@/components/player-status"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCatalogEpisodes, useCatalogTitle, useLibrary, useNetworkStatus, usePlaybackProgress } from "@/hooks"
import { createPlayback, errorMessage, fetchPlaybackSources, fetchPlaybackStatus, fetchSubtitles, isAbort, streamUrl } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { defaultDownloadManager, type DownloadManifest } from "@/offline"
import type { WatchRoute } from "@/lib/router"
import type { MediaDetails } from "../../shared/media"
import type { MediaTarget, PlaybackSource, PlaybackStatus, SubtitleTrack } from "../../shared/playback"

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
  const currentTimeRef = useRef(0)
  const durationRef = useRef(0)
  const lastSavedRef = useRef(0)
  const failedSourcesRef = useRef(new Set<string>())
  const switchingSourceRef = useRef(false)
  const [selectedSubtitle, setSelectedSubtitle] = useState("off")

  const downloadId = imdbId ? `${imdbId}${season !== null && episode !== null ? `-s${season}-e${episode}` : ""}` : ""
  const matchingDownload = manifests.find((item) => item.id === downloadId || item.id === offlineId)
  const offlineManifest = matchingDownload?.status === "completed" && (forceOffline || !network.isOnline || offlineId === matchingDownload.id) ? matchingDownload : null
  const episodeDetails = episodes.data?.results.find((item) => item.episode === episode)
  const target = useMemo<MediaTarget | null>(() => details.data && imdbId ? ({ imdbId, mediaType: details.data.mediaType, title: details.data.title, year: details.data.year, season, episode, episodeTitle: episodeDetails?.title ?? null }) : null, [details.data, episode, episodeDetails?.title, imdbId, season])

  const startSource = useCallback(async (source: PlaybackSource, targetMedia: MediaTarget, signal?: AbortSignal) => {
    setSelected(source); setStatus(null); setSubtitles([]); setError(null); setLoadingSources(true)
    try {
      const initial = await createPlayback({ target: targetMedia, sourceId: source.id, source }, signal)
      let tracks = initial.subtitles
      try { tracks = mergeTracks(initial.subtitles, await fetchSubtitles(initial.id, signal)) } catch (caught) { if (isAbort(caught)) return }
      setSubtitles(tracks); setStatus(initial); setLoadingSources(false)
    } catch (caught) {
      if (isAbort(caught)) return
      setError(errorMessage(caught)); setLoadingSources(false)
    }
  }, [])

  useEffect(() => {
    if (!target || offlineManifest || offlineId) return
    const controller = new AbortController()
    failedSourcesRef.current.clear()
    setLoadingSources(true); setError(null); setSources([]); setSelected(null); setStatus(null)
    void fetchPlaybackSources(target, controller.signal).then((found) => {
      const ranked = [...found].sort((a, b) => b.score - a.score || b.seeders - a.seeders)
      setSources(ranked)
      const best = ranked[0]
      if (!best) { setLoadingSources(false); setError("No playable sources were found for this title."); return }
      return startSource(best, target, controller.signal)
    }).catch((caught: unknown) => { if (!isAbort(caught)) { setError(errorMessage(caught)); setLoadingSources(false) } })
    return () => controller.abort()
  }, [nonce, offlineId, offlineManifest, startSource, target])

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
  if ((!details.data || details.error || !imdbId) && !offlineManifest) return <ErrorState message={details.error ?? "This title could not be prepared."} onRetry={details.retry} />
  if (!imdbId) return <ErrorState message="This download has no media identifier." onRetry={details.retry} />
  const media = details.data ?? offlineMediaDetails(offlineManifest!, imdbId)
  const displayTitle = offlineManifest?.title ?? (episodeDetails ? `${media.title} · S${season} E${episode} · ${episodeDetails.title}` : media.title)
  const onlineSource = status?.streamUrl ?? (status?.id && status.fileIndex !== null ? streamUrl(status.id, status.fileIndex) : null)
  const playerSource = offlineManifest ? defaultDownloadManager.getOfflineMediaUrl(offlineManifest.id) : onlineSource
  const playerTracks = offlineManifest ? offlineTracks(offlineManifest) : subtitles
  const qualitySources = distinctQualitySources(sources)
  const save = (position = currentTimeRef.current, duration = durationRef.current) => {
    if (!duration) return
    progress.saveProgress(position, duration)
    library.addHistory({ media, season, episode, positionSeconds: position, durationSeconds: duration, updatedAt: new Date().toISOString() })
  }
  const onTimeUpdate = ({ currentTime }: { currentTime: number }) => {
    currentTimeRef.current = currentTime
    if (Date.now() - lastSavedRef.current > 5000) { lastSavedRef.current = Date.now(); save(currentTime) }
  }
  const downloadOptions = { id: downloadId, title: displayTitle, mediaType: media.mediaType, year: media.year, mediaUrl: onlineSource ?? "", totalBytes: status?.totalBytes, subtitles: subtitles.slice(0, 3).map((track) => ({ id: track.id, label: track.label, language: track.language, url: track.url, format: track.format })), posterUrl: media.posterUrl, backdropUrl: media.backdropUrl, metadata: { imdbId, season, episode } }

  return <PageContainer className="py-5 sm:py-8"><div className="mb-5 flex items-start gap-3"><Button asChild size="icon" variant="ghost"><AppLink route={details.data ? { name: "title", id: imdbId, imdbId, type: media.mediaType } : { name: "library" }} aria-label={details.data ? `Back to ${media.title}` : "Back to library"}><ChevronLeft /></AppLink></Button><div className="min-w-0"><p className="eyebrow">{offlineManifest ? "Playing offline" : "Now playing"}</p><h1 className="mt-1 truncate text-xl font-semibold tracking-tight sm:text-2xl" title={displayTitle}>{displayTitle}</h1></div></div>
    <div className="overflow-hidden rounded-xl border border-border bg-black shadow-2xl shadow-black/30">
      {playerSource ? <><MediaPlayer key={playerSource} ref={playerRef} src={playerSource} title={displayTitle} autoPlay={library.preferences.autoplay} playsInline preload="metadata" aspectRatio="16/9" className="w-full bg-black font-sans text-white" onCanPlay={({ duration }) => { switchingSourceRef.current = false; durationRef.current = duration; const resumeAt = progress.progress && library.preferences.autoResume && !progress.progress.completed ? progress.progress.positionSeconds : 0; if (resumeAt > 5 && playerRef.current) playerRef.current.currentTime = resumeAt }} onTimeUpdate={onTimeUpdate} onPause={() => save()} onEnded={() => save(durationRef.current, durationRef.current)} onError={() => {
        if (!selected || !target || switchingSourceRef.current) return
        failedSourcesRef.current.add(selected.id)
        const fallback = sources.find((source) => isBrowserCompatible(source) && !failedSourcesRef.current.has(source.id))
        if (fallback) {
          switchingSourceRef.current = true
          void startSource(fallback, target).finally(() => { switchingSourceRef.current = false })
          return
        }
        setError("This source uses a video format your browser cannot play. Choose another source.")
      }}><MediaProvider>{playerTracks.map((track) => <Track key={track.id} id={track.id} src={track.url} type={track.format === "ass" ? "vtt" : track.format} kind="subtitles" label={track.label} lang={track.language} />)}</MediaProvider><DefaultVideoLayout icons={defaultLayoutIcons} /></MediaPlayer><div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-card/95 p-3 text-foreground">
        {qualitySources.length ? <Select value={selected?.quality ?? undefined} onValueChange={(quality) => { const source = qualitySources.find((item) => item.quality === quality); if (source && target && source.id !== selected?.id) void startSource(source, target) }}><SelectTrigger className="min-w-32 flex-1 sm:flex-none" aria-label="Video resolution"><SelectValue placeholder="Resolution" /></SelectTrigger><SelectContent>{qualitySources.map((source) => <SelectItem key={source.quality} value={source.quality}>{source.quality === "unknown" ? "Auto" : source.quality}{source.container !== "unknown" ? ` · ${source.container.toUpperCase()}` : ""}</SelectItem>)}</SelectContent></Select> : null}
        <Select value={selectedSubtitle} onValueChange={(value) => { setSelectedSubtitle(value); const tracks = playerRef.current?.textTracks; if (!tracks) return; tracks.toArray().forEach((track) => track.setMode(track.id === value ? "showing" : "disabled")) }}><SelectTrigger className="min-w-40 flex-1 sm:flex-none" aria-label="Subtitles"><Subtitles className="size-4" aria-hidden="true" /><SelectValue placeholder="Subtitles" /></SelectTrigger><SelectContent><SelectItem value="off">Subtitles off</SelectItem>{playerTracks.map((track) => <SelectItem key={track.id} value={track.id}>{subtitleOptionLabel(track, playerTracks)}</SelectItem>)}</SelectContent></Select>
        <Button variant="secondary" className="ml-auto" onClick={() => { void playerRef.current?.enterFullscreen().catch(() => setError("Fullscreen is not available in this browser.")) }}><Maximize />Fullscreen</Button>
      </div></> : <div className="flex aspect-video flex-col items-center justify-center gap-3 px-5 text-center"><Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" /><p className="font-medium">{loadingSources ? "Preparing the best available source" : "Waiting for a playable stream"}</p><p className="max-w-md text-sm text-muted-foreground">Source quality, peers, and file compatibility are checked automatically.</p></div>}
    </div>

    {error ? <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm"><p className="min-w-0 flex-1">{error}</p><Button variant="secondary" onClick={() => setNonce((value) => value + 1)}><RotateCcw />Retry</Button></div> : null}
    <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">{offlineManifest ? <section className="flex min-h-32 items-center rounded-xl border border-border bg-card p-5"><div><p className="font-semibold">Stored on this device</p><p className="mt-1 text-sm text-muted-foreground">Playback is using the completed offline copy.</p></div></section> : <PlayerStatus status={status} />}<div className="flex flex-wrap content-start gap-2 lg:w-64 lg:flex-col">
      {offlineManifest ? <span className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm"><WifiOff className="size-4 text-primary" />Available without internet</span> : null}
      {onlineSource ? <DownloadButton options={downloadOptions} manifest={matchingDownload} onError={setError} onPlay={() => setForceOffline(true)} /> : null}
      {sources.length > 1 && target ? <SourceDialog sources={sources} selected={selected} onSelect={(source) => void startSource(source, target)} /> : null}
    </div></div>
  </PageContainer>
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

function SourceDialog({ sources, selected, onSelect }: { sources: PlaybackSource[]; selected: PlaybackSource | null; onSelect: (source: PlaybackSource) => void }) {
  const [open, setOpen] = useState(false)
  return <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><Button variant="secondary"><ListVideo />Change source</Button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-70 bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in" /><Dialog.Content className="fixed inset-x-3 bottom-3 z-80 max-h-[80svh] overflow-y-auto rounded-xl border border-border bg-popover p-5 shadow-2xl outline-none sm:left-1/2 sm:top-1/2 sm:bottom-auto sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-xl font-semibold tracking-tight">Choose a source</Dialog.Title><Dialog.Description className="mt-1 text-sm text-muted-foreground">Browser-ready MP4 sources are ranked first.</Dialog.Description></div><Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Close source picker"><X /></Button></Dialog.Close></div><div className="mt-5 space-y-2">{sources.map((source) => <Button key={source.id} variant="outline" onClick={() => { onSelect(source); setOpen(false) }} className="grid h-auto min-h-16 w-full grid-cols-[1fr_auto] items-center gap-4 p-3 text-left"><span className="min-w-0"><span className="block truncate text-sm font-semibold">{source.name}</span><span className="mt-1 block text-xs text-muted-foreground">{source.quality}{source.container !== "unknown" ? ` · ${source.container.toUpperCase()}` : ""} · {source.seeders} seeders · {formatBytes(source.sizeBytes ?? 0)}</span></span>{selected?.id === source.id ? <Check className="size-5 text-primary" /> : <Play className="size-4 text-muted-foreground" />}</Button>)}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

function isBrowserCompatible(source: PlaybackSource): boolean {
  return source.container === "mp4" || source.container === "webm"
}

function distinctQualitySources(sources: PlaybackSource[]): PlaybackSource[] {
  const compatible = sources.filter(isBrowserCompatible)
  const candidates = compatible.length ? compatible : sources
  return Array.from(new Map(candidates.map((source) => [source.quality, source])).values())
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
