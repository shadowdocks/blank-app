import { Gauge, HardDrive, Users } from "lucide-react"

import { Progress } from "@/components/ui/progress"
import { formatBytes, formatSpeed } from "@/lib/format"
import type { PlaybackStatus } from "../../shared/playback"

const labels: Record<PlaybackStatus["state"], string> = { resolving: "Resolving source", connecting: "Connecting to peers", downloading: "Buffering", ready: "Ready to play", complete: "Download complete", error: "Playback error" }

export function PlayerStatus({ status }: { status: PlaybackStatus | null }) {
  const percent = Math.max(0, Math.min(100, (status?.progress ?? 0) * 100))
  return <section aria-live="polite" aria-label="Playback status" className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex items-center justify-between gap-4 text-sm"><span className="font-semibold">{status ? labels[status.state] : "Finding the best source"}</span><span className="tabular-nums text-muted-foreground">{Math.round(percent)}%</span></div>
    <Progress className="mt-3" value={percent} aria-label={`${Math.round(percent)}% buffered`} />
    <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-muted-foreground"><span><Users className="mb-1 size-4 text-foreground" aria-hidden="true" />{status?.peers ?? 0} peers</span><span><Gauge className="mb-1 size-4 text-foreground" aria-hidden="true" />{formatSpeed(status?.downloadSpeed ?? 0)}</span><span><HardDrive className="mb-1 size-4 text-foreground" aria-hidden="true" />{formatBytes(status?.downloadedBytes ?? 0)}</span></div>
  </section>
}
