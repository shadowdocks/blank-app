import { useEffect, useState } from "react"
import { Download, Pause, Play, RotateCcw, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatBytes } from "@/lib/format"
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

export function DownloadButton({ options, manifest, onError, onPlay }: { options: CreateDownloadOptions; manifest?: DownloadManifest; onError: (message: string) => void; onPlay?: () => void }) {
  const run = (task: Promise<unknown>) => void task.catch((error: unknown) => onError(error instanceof Error ? error.message : "The download could not be updated."))
  if (manifest?.status === "completed") return <Button variant="secondary" onClick={onPlay ?? (() => window.location.assign(defaultDownloadManager.getOfflineMediaUrl(manifest.id)))}><Play aria-hidden="true" />Play offline</Button>
  if (manifest?.status === "downloading" || manifest?.status === "queued") return <Button variant="secondary" onClick={() => run(defaultDownloadManager.pauseDownload(manifest.id))}><Pause aria-hidden="true" />Pause download</Button>
  if (manifest && ["paused", "error", "cancelled"].includes(manifest.status)) return <Button variant="secondary" onClick={() => run(defaultDownloadManager.resumeDownload(manifest.id))}><RotateCcw aria-hidden="true" />Resume download</Button>
  return <Button variant="secondary" onClick={() => run(defaultDownloadManager.startDownload(options))}><Download aria-hidden="true" />Download</Button>
}

export function DownloadRow({ manifest, onError, onPlay }: { manifest: DownloadManifest; onError: (message: string) => void; onPlay?: () => void }) {
  const progress = calculateManifestProgress(manifest)
  const run = (task: Promise<unknown>) => void task.catch((error: unknown) => onError(error instanceof Error ? error.message : "The download could not be updated."))
  return <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="truncate font-semibold">{manifest.title}</h3><span className="text-xs capitalize text-muted-foreground">{manifest.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{manifest.mediaType === "tv" ? "Series" : "Movie"}{manifest.year ? ` · ${manifest.year}` : ""} · {formatBytes(manifest.downloadedBytes)} of {formatBytes(manifest.totalBytes)}</p><Progress className="mt-3" value={progress.percent} aria-label={`${progress.percent}% downloaded`} />{manifest.error ? <p className="mt-2 text-xs text-destructive">{manifest.error}</p> : null}</div>
      <div className="flex flex-wrap gap-2">
        {manifest.status === "completed" ? <Button onClick={onPlay ?? (() => window.location.assign(defaultDownloadManager.getOfflineMediaUrl(manifest.id)))}><Play aria-hidden="true" />Play</Button> : manifest.status === "downloading" || manifest.status === "queued" ? <Button variant="secondary" onClick={() => run(defaultDownloadManager.pauseDownload(manifest.id))}><Pause aria-hidden="true" />Pause</Button> : <Button variant="secondary" onClick={() => run(defaultDownloadManager.resumeDownload(manifest.id))}><RotateCcw aria-hidden="true" />Resume</Button>}
        <Button size="icon" variant="ghost" aria-label={`Delete ${manifest.title} download`} onClick={() => run(defaultDownloadManager.deleteDownload(manifest.id))}><Trash2 /></Button>
      </div>
    </div>
  </article>
}
