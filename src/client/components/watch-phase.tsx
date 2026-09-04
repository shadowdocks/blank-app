import { useEffect, useState } from "react"
import { MediaPlayer, MediaProvider, Track } from "@vidstack/react"
import { DefaultVideoLayout, defaultLayoutIcons } from "@vidstack/react/player/layouts/default"
import "@vidstack/react/player/styles/default/theme.css"
import "@vidstack/react/player/styles/default/layouts/video.css"
import {
  ArrowLeft,
  Gauge,
  HardDrive,
  House,
  ListVideo,
  Loader2,
  RotateCcw,
  Users,
} from "lucide-react"

import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { streamUrl } from "@/lib/api"
import { formatBytes, formatElapsed, formatPercent, formatSpeed } from "@/lib/format"
import type { ActiveTorrent, TorrentStatus } from "@/lib/types"

const LANGUAGE_NAMES: Record<string, { label: string; language: string }> = {
  eng: { label: "English", language: "en" },
  english: { label: "English", language: "en" },
  fre: { label: "French", language: "fr" },
  fra: { label: "French", language: "fr" },
  french: { label: "French", language: "fr" },
  spa: { label: "Spanish", language: "es" },
  spanish: { label: "Spanish", language: "es" },
}

function subtitleInfo(name: string): { label: string; language?: string; type: "srt" | "vtt" } | null {
  const extension = name.split(".").pop()?.toLowerCase()
  if (extension !== "srt" && extension !== "vtt") return null
  const filename = name.split("/").pop() ?? name
  const tokens = filename.toLowerCase().replace(/\.(srt|vtt)$/, "").split(/[^a-z]+/).filter(Boolean)
  const language = tokens.map((token) => LANGUAGE_NAMES[token]).find(Boolean)
  const hearingImpaired = tokens.some((token) => token === "hi" || token === "sdh")
  const label = language
    ? `${language.label}${hearingImpaired ? " (SDH)" : ""}`
    : filename.replace(/\.(srt|vtt)$/i, "").replace(/[._-]+/g, " ").trim() || "Subtitles"
  return { label, language: language?.language, type: extension }
}

const EVENT_LABELS: Record<string, string> = {
  connecting: "Connecting",
  resolving_metadata: "Resolving metadata",
  finding_peers: "Finding peers",
  metadata_ready: "Metadata ready",
  peer_connected: "Peers connected",
  complete: "Download complete",
  error: "Torrent error",
}

function eventLabel(event: string): string {
  return EVENT_LABELS[event] ?? "Working"
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: string
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

export function WatchPhase({
  torrent,
  status,
  error,
  onRetry,
  onChangeSource,
  onBackToTitle,
  onHome,
}: {
  torrent: ActiveTorrent
  status: TorrentStatus | null
  error: string | null
  onRetry: () => void
  /** Absent when the stream was recovered without a known title. */
  onChangeSource?: () => void
  onBackToTitle?: () => void
  onHome: () => void
}) {
  const video = status?.video ?? torrent.video
  const source = video === null ? null : streamUrl(torrent.infoHash, video)
  const [playbackError, setPlaybackError] = useState(false)

  useEffect(() => {
    setPlaybackError(false)
  }, [source])

  const retry = () => {
    setPlaybackError(false)
    onRetry()
  }

  const percent = status ? Math.min(100, Math.max(0, status.progress * 100)) : 0
  const name = status?.name && status.name !== "Resolving metadata" ? status.name : torrent.name
  const subtitles = (status?.subtitles ?? []).flatMap((track) => {
    const info = subtitleInfo(track.name)
    return info ? [{ ...track, ...info }] : []
  })

  return (
    <section className="animate-rise space-y-6">
      <header className="space-y-1">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Now streaming</p>
        <h1 className="truncate text-xl font-semibold tracking-tight" title={name}>
          {name}
        </h1>
      </header>

      <div className="overflow-hidden rounded-lg border border-border bg-black shadow-2xl shadow-black/20">
        {source && !playbackError ? (
          <MediaPlayer
            key={source}
            src={source}
            title={name}
            autoPlay
            playsInline
            preload="metadata"
            aspectRatio="16/9"
            className="w-full bg-black font-sans text-white"
            onError={() => setPlaybackError(true)}
          >
            <MediaProvider>
              {subtitles.map((track) => (
                <Track
                  key={String(track.index)}
                  src={streamUrl(torrent.infoHash, track.index)}
                  type={track.type}
                  kind="subtitles"
                  label={track.label}
                  lang={track.language}
                />
              ))}
            </MediaProvider>
            <DefaultVideoLayout icons={defaultLayoutIcons} />
          </MediaPlayer>
        ) : (
          <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 bg-card px-6 text-center">
            {playbackError ? (
              <>
                <p className="text-sm font-medium">Playback stopped</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  The stream could not be decoded or the connection dropped. Retry, or pick a
                  different source.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={retry}>
                    <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    Retry
                  </Button>
                  {onChangeSource ? (
                    <Button size="sm" variant="secondary" onClick={onChangeSource}>
                      <ListVideo data-icon="inline-start" aria-hidden="true" />
                      Change source
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <Loader2 className="size-5 animate-spin text-primary" aria-hidden="true" />
                <p aria-live="polite" className="text-sm font-medium">
                  {status ? eventLabel(status.lastEvent) : "Contacting the swarm"}
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {status?.metadata
                    ? "Buffering the first pieces of the file."
                    : "Waiting for peers to hand over the file list. This can take a moment."}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {error ? (
        <Notice
          action={
            <Button size="sm" variant="secondary" onClick={retry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}

      <div className="space-y-4 rounded-md border border-border bg-card px-4 py-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium">
              {status?.done
                ? "Download complete"
                : status
                  ? eventLabel(status.lastEvent)
                  : "Connecting"}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {status?.metadata ? formatPercent(status.progress) : "Metadata pending"}
            </span>
          </div>
          <Progress
            value={percent}
            aria-label="Download progress"
            className={status?.metadata ? undefined : "opacity-50"}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat icon={Users} label="Peers" value={String(status?.numPeers ?? 0)} />
          <Stat icon={Gauge} label="Speed" value={formatSpeed(status?.downloadSpeed ?? 0)} />
          <Stat
            icon={HardDrive}
            label="Downloaded"
            value={
              status && status.length
                ? `${formatBytes(status.downloaded)} / ${formatBytes(status.length)}`
                : formatBytes(status?.downloaded ?? 0)
            }
          />
          <Stat icon={ListVideo} label="Elapsed" value={formatElapsed(status?.elapsedMs ?? 0)} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onChangeSource ? (
          <Button variant="secondary" size="lg" onClick={onChangeSource}>
            <ListVideo data-icon="inline-start" aria-hidden="true" />
            Change source
          </Button>
        ) : null}
        <Button variant="ghost" size="lg" onClick={retry}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          Retry stream
        </Button>
        {onBackToTitle ? (
          <Button variant="ghost" size="lg" onClick={onBackToTitle}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back to title
          </Button>
        ) : (
          <Button variant="ghost" size="lg" onClick={onHome}>
            <House data-icon="inline-start" aria-hidden="true" />
            Home
          </Button>
        )}
      </div>
    </section>
  )
}
