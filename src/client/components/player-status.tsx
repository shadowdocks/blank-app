import { formatSpeed } from "@/lib/format"
import type { PlaybackStatus } from "../../shared/playback"

const labels: Record<PlaybackStatus["state"], string> = { resolving: "Resolving", connecting: "Connecting", downloading: "Buffering", ready: "Ready", complete: "Cached", error: "Error" }

/**
 * Compact stream-health line for the player chrome: state, cached percent,
 * speed and peers while a torrent is active; a single word when offline.
 */
export function PlayerStatus({ status, offline = false, switching = false }: { status: PlaybackStatus | null; offline?: boolean; switching?: boolean }) {
  const percent = Math.round(Math.max(0, Math.min(100, (status?.progress ?? 0) * 100)))
  const state = offline ? "offline" : switching ? "resolving" : status?.state ?? "resolving"
  const label = offline ? "Offline copy" : switching ? "Switching source" : status ? labels[status.state] : "Finding source"
  return (
    <p className="hawk-status" data-state={state} aria-live="polite" aria-label="Stream status">
      <span className="hawk-status-dot" aria-hidden="true" />
      <span>{label}</span>
      {!offline && status && !switching ? (
        <>
          <span aria-hidden="true">·</span>
          <span>{percent}%</span>
          {status.state === "downloading" || status.state === "ready" ? (
            <span className="hidden sm:inline">
              <span aria-hidden="true"> · </span>{formatSpeed(status.downloadSpeed)}<span aria-hidden="true"> · </span>{status.peers} peers
            </span>
          ) : null}
        </>
      ) : null}
    </p>
  )
}
