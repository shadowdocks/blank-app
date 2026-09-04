import { useEffect, useState } from "react"
import { Download, Pause, Play, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { calculateManifestProgress, defaultDownloadManager, type CreateDownloadOptions, type DownloadManifest } from "@/offline"

export function useDownloads() {
  const [manifests, setManifests] = useState<DownloadManifest[]>(() => defaultDownloadManager.getManifests())
  useEffect(() => {
    let active = true
    let unsubscribe = () => {}
    void defaultDownloadManager.init().then(() => {
      if (!active) return
      setManifests(defaultDownloadManager.getManifests())
      unsubscribe = defaultDownloadManager.subscribe(setManifests)
    })
    return () => { active = false; unsubscribe() }
  }, [])
  return manifests
}

/**
 * One button that follows the manifest lifecycle. `chrome` renders it as a
 * player control (round, white, icon with a short label from `sm` up).
 */
export function DownloadButton({ options, manifest, onError, onPlay, chrome = false }: { options: CreateDownloadOptions; manifest?: DownloadManifest; onError: (message: string) => void; onPlay?: () => void; chrome?: boolean }) {
  const run = (task: Promise<unknown>) => void task.catch((error: unknown) => onError(error instanceof Error ? error.message : "The download could not be updated."))
  const playOffline = onPlay ?? (() => window.location.assign(defaultDownloadManager.getOfflineMediaUrl(manifest!.id)))
  const state = manifest?.status === "completed"
    ? { label: "Play offline", icon: Play, action: playOffline }
    : manifest?.status === "downloading" || manifest?.status === "queued"
      ? { label: "Pause download", icon: Pause, action: () => run(defaultDownloadManager.pauseDownload(manifest.id)) }
      : manifest && ["paused", "error", "cancelled"].includes(manifest.status)
        ? { label: "Resume download", icon: RotateCcw, action: () => run(defaultDownloadManager.resumeDownload(manifest.id)) }
        : { label: "Download", icon: Download, action: () => run(defaultDownloadManager.startDownload(options)) }
  const percent = manifest && manifest.status !== "completed" ? calculateManifestProgress(manifest).percent : null
  if (chrome) {
    return (
      <button type="button" className={cn("hawk-button", percent !== null && "tabular-nums")} onClick={state.action} aria-label={percent !== null ? `${state.label}, ${percent}% downloaded` : state.label}>
        <state.icon aria-hidden="true" />
        <span className="hidden sm:inline">{percent !== null ? `${percent}%` : state.label}</span>
      </button>
    )
  }
  return <Button variant="secondary" onClick={state.action}><state.icon aria-hidden="true" />{state.label}</Button>
}

export function DownloadRow({ manifest, onError, onPlay }: { manifest: DownloadManifest; onError: (message: string) => void; onPlay?: () => void }) {
  const progress = calculateManifestProgress(manifest)
  const run = (task: Promise<unknown>) => void task.catch((error: unknown) => onError(error instanceof Error ? error.message : "The download could not be updated."))
  return <article className="surface p-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="truncate font-semibold">{manifest.title}</h3><span className="text-xs capitalize text-muted-foreground">{manifest.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{manifest.year ? `${manifest.year} · ` : ""}{manifest.mediaType === "tv" ? "Series" : "Film"} · {formatBytes(manifest.downloadedBytes)} of {formatBytes(manifest.totalBytes)}</p><Progress className="mt-3" value={progress.percent} aria-label={`${progress.percent}% downloaded`} />{manifest.error ? <p className="mt-2 text-xs text-destructive">{manifest.error}</p> : null}</div>
      <div className="flex flex-wrap gap-2">
        {manifest.status === "completed" ? <Button onClick={onPlay ?? (() => window.location.assign(defaultDownloadManager.getOfflineMediaUrl(manifest.id)))}><Play aria-hidden="true" />Play</Button> : manifest.status === "downloading" || manifest.status === "queued" ? <Button variant="secondary" onClick={() => run(defaultDownloadManager.pauseDownload(manifest.id))}><Pause aria-hidden="true" />Pause</Button> : <Button variant="secondary" onClick={() => run(defaultDownloadManager.resumeDownload(manifest.id))}><RotateCcw aria-hidden="true" />Resume</Button>}
        <Button size="icon" variant="ghost" aria-label={`Delete ${manifest.title} download`} onClick={() => run(defaultDownloadManager.deleteDownload(manifest.id))}><Trash2 /></Button>
      </div>
    </div>
  </article>
}
