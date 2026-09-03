import { useEffect, useState } from "react"
import { ArrowLeft, Gauge, HardDrive, Loader2, ListVideo, RotateCcw, Users } from "lucide-react"

import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { streamUrl } from "@/lib/api"
import { formatBytes, formatElapsed, formatPercent, formatSpeed } from "@/lib/format"
import type { ActiveTorrent, TorrentStatus } from "@/lib/types"

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
  onBack,
}: {
  torrent: ActiveTorrent
  status: TorrentStatus | null
  error: string | null
  onRetry: () => void
  onChangeSource: () => void
  onBack: () => void
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

  return (
    <section className="animate-rise space-y-6">
      <header className="space-y-1">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Now streaming</p>
        <h1 className="truncate text-xl font-semibold tracking-tight" title={name}>
          {name}
        </h1>
      </header>

      <div className="overflow-hidden rounded-md border border-border bg-black">
        {source && !playbackError ? (
          <video
            key={source}
            src={source}
            controls
            autoPlay
            playsInline
            preload="metadata"
            className="aspect-video w-full bg-black"
            onError={() => setPlaybackError(true)}
          />
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
                  <Button size="sm" variant="secondary" onClick={onChangeSource}>
                    <ListVideo data-icon="inline-start" aria-hidden="true" />
                    Change source
                  </Button>
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
              {status?.done ? "Download complete" : status ? eventLabel(status.lastEvent) : "Connecting"}
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
        <Button variant="secondary" size="lg" onClick={onChangeSource}>
          <ListVideo data-icon="inline-start" aria-hidden="true" />
          Change source
        </Button>
        <Button variant="ghost" size="lg" onClick={retry}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          Retry stream
        </Button>
        <Button variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back to title
        </Button>
      </div>
    </section>
  )
}
