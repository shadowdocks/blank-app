import * as React from "react"
import {
  Captions,
  Controls,
  FullscreenButton,
  Gesture,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PlayButton,
  Poster,
  Time,
  TimeSlider,
  Track,
  VolumeSlider,
  useCaptionOptions,
  useMediaPlayer,
  useMediaState,
  type MediaPlayerInstance,
} from "@vidstack/react"
import { ArrowLeft, Captions as CaptionsIcon, Check, Loader2, Maximize, Minimize, Pause, Play, RotateCcw, SlidersHorizontal, Volume1, Volume2, VolumeX } from "lucide-react"
import "@vidstack/react/player/styles/base.css"

import { cn } from "@/lib/utils"
import { formatBytes } from "@/lib/format"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { PlaybackSource, VideoQuality } from "../../shared/playback"

export interface PlayerTrack {
  id: string
  src: string
  label: string
  lang: string
  type: "vtt" | "srt"
  default?: boolean
}

export interface QualityOption {
  id: string
  label: string
  detail?: string
}

export interface PlayerNotice {
  message: string
  onRetry?: () => void
  retryLabel?: string
}

export interface VideoPlayerProps {
  src: string
  mimeType?: "video/mp4" | "video/webm"
  title: string
  subtitle?: string | null
  poster?: string | null
  tracks: PlayerTrack[]
  qualities: QualityOption[]
  /** Id of the active quality option; `null` while resolving. */
  activeQuality: string | null
  onSelectQuality: (id: string) => void
  /** Every source; enables the "All sources" picker when more than one. */
  sources?: PlaybackSource[]
  onSelectSource?: (source: PlaybackSource) => void
  onBack: () => void
  autoPlay: boolean
  /** Fill the parent instead of keeping 16:9. */
  viewport?: boolean
  /** Compact stream state shown in the top bar. */
  status?: React.ReactNode
  /** Extra top-bar controls (download). */
  actions?: React.ReactNode
  /** Blocking notice rendered over the video (errors, retry). */
  notice?: PlayerNotice | null
  playerRef: React.RefObject<MediaPlayerInstance | null>
  onCanPlay: (duration: number) => void
  onTimeUpdate: (currentTime: number, duration: number) => void
  onPause: (currentTime: number, duration: number) => void
  onEnded: (duration: number) => void
  onError: () => void
  className?: string
}

/**
 * Hawk's integrated player. All controls live inside the Vidstack player so
 * they follow it into fullscreen: playback, seeking, volume, subtitles,
 * resolution, the full source list, download, and stream status.
 */
export function VideoPlayer({
  src,
  mimeType,
  title,
  subtitle,
  poster,
  tracks,
  qualities,
  activeQuality,
  onSelectQuality,
  sources = [],
  onSelectSource,
  onBack,
  autoPlay,
  viewport = false,
  status,
  actions,
  notice,
  playerRef,
  onCanPlay,
  onTimeUpdate,
  onPause,
  onEnded,
  onError,
  className,
}: VideoPlayerProps) {
  const [sourcesOpen, setSourcesOpen] = React.useState(false)
  const canPickSources = sources.length > 1 && Boolean(onSelectSource)
  return (
    <MediaPlayer
      ref={playerRef}
      className={cn("hawk-player", className)}
      data-viewport={viewport ? "true" : undefined}
      src={mimeType ? { src, type: mimeType } : src}
      title={title}
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      controlsDelay={2600}
      hideControlsOnMouseLeave
      onCanPlay={({ duration }) => onCanPlay(duration)}
      onTimeUpdate={({ currentTime }) => onTimeUpdate(currentTime, playerRef.current?.duration ?? 0)}
      onPause={() => onPause(playerRef.current?.currentTime ?? 0, playerRef.current?.duration ?? 0)}
      onEnded={() => onEnded(playerRef.current?.duration ?? 0)}
      onError={onError}
    >
      <MediaProvider>
        {poster ? <Poster className="hawk-poster" src={poster} alt="" /> : null}
        {tracks.map((track) => (
          <Track key={track.id} id={track.id} src={track.src} type={track.type} kind="subtitles" label={track.label} lang={track.lang} default={track.default} />
        ))}
      </MediaProvider>

      <Gesture className="absolute inset-0 z-0" event="pointerup" action="toggle:controls" />
      <Gesture className="absolute inset-0 z-0" event="pointerup" action="toggle:paused" />
      <Gesture className="absolute inset-y-0 left-0 z-0 w-1/5" event="dblpointerup" action="seek:-10" />
      <Gesture className="absolute inset-y-0 right-0 z-0 w-1/5" event="dblpointerup" action="seek:10" />
      <Gesture className="absolute inset-y-0 left-1/5 right-1/5 z-0" event="dblpointerup" action="toggle:fullscreen" />

      <Captions className="vds-captions" />
      {notice ? <NoticeOverlay notice={notice} /> : <CenterState />}

      <Controls.Root className="hawk-controls">
        <Controls.Group className="hawk-controls-top">
          <button type="button" className="hawk-button" onClick={onBack} aria-label="Back to details">
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
            <div className="flex min-w-0 items-center gap-2 text-xs text-white/70">
              {subtitle ? <span className="truncate">{subtitle}</span> : null}
              {subtitle && status ? <span aria-hidden="true">·</span> : null}
              {status}
            </div>
          </div>
          {actions}
        </Controls.Group>

        <Controls.Group className="hawk-controls-bottom">
          <TimeSlider.Root className="hawk-time-slider" aria-label="Seek">
            <TimeSlider.Track className="hawk-time-track">
              <TimeSlider.Progress className="hawk-time-progress" />
              <TimeSlider.TrackFill className="hawk-time-fill" />
            </TimeSlider.Track>
            <TimeSlider.Thumb className="hawk-time-thumb" />
            <TimeSlider.Preview className="hawk-time-preview">
              <TimeSlider.Value />
            </TimeSlider.Preview>
          </TimeSlider.Root>

          <div className="flex items-center gap-0.5 sm:gap-1">
            <PlayPause />
            <Volume />
            <span className="ml-1 hidden text-xs tabular-nums text-white/85 sm:inline-flex sm:items-center sm:gap-1">
              <Time type="current" /><span aria-hidden="true">/</span><Time type="duration" />
            </span>
            <span className="ml-1 inline-flex items-center gap-1 text-xs tabular-nums text-white/85 sm:hidden">
              <Time type="current" />
            </span>
            <span className="flex-1" />
            <SubtitleMenu hasTracks={tracks.length > 0} />
            <QualityMenu qualities={qualities} activeQuality={activeQuality} onSelect={onSelectQuality} onOpenSources={canPickSources ? () => setSourcesOpen(true) : undefined} />
            <Fullscreen />
          </div>
        </Controls.Group>
      </Controls.Root>

      {canPickSources ? <SourceDialog open={sourcesOpen} onOpenChange={setSourcesOpen} sources={sources} activeId={activeQuality} onSelect={onSelectSource!} /> : null}
    </MediaPlayer>
  )
}

/**
 * Same chrome without a media element, for the moments before a stream URL
 * exists: back, title, and a loading or error notice.
 */
export function PlayerPlaceholder({ title, subtitle, onBack, notice, loading, viewport = false, className }: { title: string; subtitle?: string | null; onBack: () => void; notice?: PlayerNotice | null; loading?: string; viewport?: boolean; className?: string }) {
  return (
    <div className={cn("hawk-player", className)} data-viewport={viewport ? "true" : undefined} aria-busy={!notice}>
      <div className="hawk-controls" data-visible="">
        <div className="hawk-controls-top">
          <button type="button" className="hawk-button" onClick={onBack} aria-label="Back to details">
            <ArrowLeft aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold sm:text-base">{title}</p>
            {subtitle ? <p className="truncate text-xs text-white/70">{subtitle}</p> : null}
          </div>
        </div>
      </div>
      {notice ? <NoticeOverlay notice={notice} /> : (
        <div className="absolute inset-0 z-11 grid place-items-center px-6 text-center" role="status">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="size-8 animate-spin text-white/90" aria-hidden="true" />
            <p className="text-sm font-medium text-white/85">{loading ?? "Preparing the best available source"}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function NoticeOverlay({ notice }: { notice: PlayerNotice }) {
  return (
    <div className="hawk-overlay" role="alert">
      <div className="flex max-w-md flex-col items-center gap-4">
        <p className="text-sm text-white/90 sm:text-base">{notice.message}</p>
        {notice.onRetry ? (
          <button type="button" className="hawk-button bg-white/12 px-4" onClick={notice.onRetry}>
            <RotateCcw aria-hidden="true" />{notice.retryLabel ?? "Retry"}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function CenterState() {
  const paused = useMediaState("paused")
  const waiting = useMediaState("waiting")
  const canPlay = useMediaState("canPlay")
  const busy = waiting || !canPlay
  if (busy) {
    return (
      <div className="pointer-events-none absolute inset-0 z-11 grid place-items-center" role="status" aria-label="Buffering">
        <Loader2 className="size-10 animate-spin text-white/90" aria-hidden="true" />
      </div>
    )
  }
  if (!paused) return null
  return (
    <PlayButton className="hawk-center-play" aria-label="Play">
      <Play aria-hidden="true" fill="currentColor" />
    </PlayButton>
  )
}

function PlayPause() {
  const paused = useMediaState("paused")
  return (
    <PlayButton className="hawk-button" aria-label={paused ? "Play" : "Pause"}>
      {paused ? <Play aria-hidden="true" fill="currentColor" /> : <Pause aria-hidden="true" fill="currentColor" />}
    </PlayButton>
  )
}

function Volume() {
  const muted = useMediaState("muted")
  const volume = useMediaState("volume")
  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  return (
    <div className="hawk-volume-group flex items-center">
      <MuteButton className="hawk-button" aria-label={muted ? "Unmute" : "Mute"}>
        <Icon aria-hidden="true" />
      </MuteButton>
      <VolumeSlider.Root className="hawk-volume" aria-label="Volume">
        <VolumeSlider.Track className="hawk-volume-track">
          <VolumeSlider.TrackFill className="hawk-volume-fill" />
        </VolumeSlider.Track>
      </VolumeSlider.Root>
    </div>
  )
}

function Fullscreen() {
  const fullscreen = useMediaState("fullscreen")
  const canFullscreen = useMediaState("canFullscreen")
  if (!canFullscreen) return null
  return (
    <FullscreenButton className="hawk-button" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
      {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
    </FullscreenButton>
  )
}

/** Keeps the controls awake while a menu is open and portals it into the player for fullscreen. */
function usePlayerMenu(controlled?: boolean) {
  const player = useMediaPlayer()
  const [open, setOpen] = React.useState(false)
  const isOpen = controlled ?? open
  React.useEffect(() => {
    if (!player) return
    player.controls.canIdle = !isOpen
    if (isOpen) player.controls.show()
    return () => { player.controls.canIdle = true }
  }, [isOpen, player])
  return { open, setOpen, container: player?.el ?? null }
}

function SubtitleMenu({ hasTracks }: { hasTracks: boolean }) {
  const options = useCaptionOptions({ off: "Off" })
  const menu = usePlayerMenu()
  const active = options.selectedTrack
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.setOpen} modal={false}>
      <DropdownMenuTrigger className="hawk-button" aria-label={`Subtitles: ${active ? active.label : "off"}`} disabled={!hasTracks}>
        <CaptionsIcon aria-hidden="true" className={active ? undefined : "opacity-70"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent container={menu.container} align="end" className="max-h-[60vh]">
        <DropdownMenuLabel>Subtitles</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={options.selectedValue} onValueChange={(value) => options.find((option) => option.value === value)?.select()}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QualityMenu({ qualities, activeQuality, onSelect, onOpenSources }: { qualities: QualityOption[]; activeQuality: string | null; onSelect: (id: string) => void; onOpenSources?: () => void }) {
  const menu = usePlayerMenu()
  const active = qualities.find((quality) => quality.id === activeQuality) ?? null
  return (
    <DropdownMenu open={menu.open} onOpenChange={menu.setOpen} modal={false}>
      <DropdownMenuTrigger className="hawk-button px-2.5" aria-label={`Quality: ${active ? `${active.label}${active.detail ? ` ${active.detail}` : ""}` : "unknown"}`}>
        <SlidersHorizontal aria-hidden="true" className="hidden sm:block" />
        <span className="tabular-nums">{active?.label ?? "Source"}</span>
        {active?.detail ? <span className="hidden text-white/60 sm:inline">{active.detail}</span> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent container={menu.container} align="end">
        <DropdownMenuLabel>Quality</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={activeQuality ?? ""} onValueChange={onSelect}>
          {qualities.map((quality) => (
            <DropdownMenuRadioItem key={quality.id} value={quality.id}>
              <span className="tabular-nums">{quality.label}</span>
              {quality.detail ? <span className="ml-auto pl-4 text-xs text-muted-foreground">{quality.detail}</span> : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onOpenSources ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onOpenSources} className="pl-3 text-muted-foreground">All sources…</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function qualityLabel(quality: VideoQuality): string {
  return quality === "unknown" ? "Unknown resolution" : quality
}

export function isBrowserCompatible(source: PlaybackSource): boolean {
  return source.container === "mp4" || source.container === "webm"
}

/** Full source list, portaled into the player so it survives native fullscreen. */
function SourceDialog({ open, onOpenChange, sources, activeId, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; sources: PlaybackSource[]; activeId: string | null; onSelect: (source: PlaybackSource) => void }) {
  const menu = usePlayerMenu(open)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent container={menu.container} size="lg" closeLabel="Close source picker" className="sm:max-h-[80svh]" onOpenAutoFocus={(event) => event.preventDefault()}>
        <DialogHeader className="pr-12">
          <DialogTitle className="text-xl font-semibold tracking-tight">All sources</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">MP4 and WebM play directly in the browser. Other containers may need a fallback.</DialogDescription>
        </DialogHeader>
        <ul className="mt-5 min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
          {sources.map((source) => {
            const active = activeId === source.id
            return (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => { onSelect(source); onOpenChange(false) }}
                  aria-current={active ? "true" : undefined}
                  className={`grid min-h-16 w-full grid-cols-[1fr_auto] items-center gap-4 rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-white/30 bg-white/6" : "border-border/70 hover:bg-white/5"}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{source.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{qualityLabel(source.quality)}{source.container !== "unknown" ? ` · ${source.container.toUpperCase()}` : ""} · {source.seeders} seeders · {formatBytes(source.sizeBytes ?? 0)}{isBrowserCompatible(source) ? "" : " · may not play in browser"}</span>
                  </span>
                  {active ? <Check className="size-5" aria-hidden="true" /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
