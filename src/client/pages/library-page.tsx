import { Clock3, Play, Trash2 } from "lucide-react"
import { useState } from "react"

import { DownloadRow, useDownloads } from "@/components/downloads"
import { MediaCard, bookmarkToSummary } from "@/components/media-card"
import { CollectionEmpty, PageContainer, PageHeading } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useLibrary } from "@/hooks"
import { navigate } from "@/lib/router"

export function LibraryPage() {
  const library = useLibrary()
  const downloads = useDownloads()
  const [message, setMessage] = useState<string | null>(null)
  const tabs = [
    { value: "saved", label: "Saved", count: library.bookmarks.length },
    { value: "history", label: "History", count: library.history.length },
    { value: "downloads", label: "Downloads", count: downloads.length },
  ]
  return (
    <PageContainer className="animate-fade pb-8 pt-24 sm:pt-28">
      <PageHeading title="Library" />
      <Tabs defaultValue="saved" className="mt-8">
        <TabsList aria-label="Library sections">
          {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}<span className="text-xs tabular-nums text-muted-foreground">{tab.count}</span></TabsTrigger>)}
        </TabsList>

        <TabsContent value="saved">
          {library.bookmarks.length ? <div className="media-grid">{library.bookmarks.map((item) => <MediaCard key={item.imdbId} media={bookmarkToSummary(item)} />)}</div> : <CollectionEmpty title="Nothing saved yet" description="Add titles to your library to keep them close." />}
        </TabsContent>

        <TabsContent value="history">
          {library.history.length ? (
            <div className="space-y-2">
              <div className="flex justify-end"><Button variant="ghost" onClick={library.clearHistory}>Clear history</Button></div>
              {library.history.map((record) => {
                const id = record.media.imdbId || record.media.id
                const key = record.season !== null && record.episode !== null ? `${id}:s${record.season}:e${record.episode}` : id
                const pct = Math.round((library.progress[key]?.progressFraction ?? 0) * 100)
                return (
                  <article key={`${id}-${record.season}-${record.episode}`} className="surface flex items-center gap-4 p-3 sm:p-4">
                    <div className="relative hidden aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
                      {record.media.backdropUrl || record.media.posterUrl ? <img src={record.media.backdropUrl || record.media.posterUrl || ""} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                      {pct > 0 ? <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><span className="block h-full bg-white" style={{ width: `${pct}%` }} /></span> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{record.media.title}</h3>
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" />{record.season !== null ? `S${record.season} E${record.episode} · ` : ""}{Math.round(record.positionSeconds / 60)} min watched</p>
                    </div>
                    <Button size="icon" variant="ghost" aria-label={`Remove ${record.media.title} from history`} onClick={() => library.removeHistory(id, record.season, record.episode)}><Trash2 /></Button>
                    <Button size="icon" aria-label={`Continue ${record.media.title}`} onClick={() => navigate(record.season !== null && record.episode !== null ? { name: "watch", imdbId: id, season: record.season, episode: record.episode } : { name: "watch", imdbId: id })}><Play className="fill-current" /></Button>
                  </article>
                )
              })}
            </div>
          ) : <CollectionEmpty title="No watch history" description="Titles you play will appear here." />}
        </TabsContent>

        <TabsContent value="downloads">
          {message ? <p role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">{message}</p> : null}
          {downloads.length ? (
            <div className="space-y-2">
              {downloads.map((manifest) => (
                <DownloadRow key={manifest.id} manifest={manifest} onError={setMessage} onPlay={() => {
                  sessionStorage.setItem("hawk.playOffline", manifest.id)
                  const imdbId = String(manifest.metadata.imdbId ?? manifest.id)
                  const season = typeof manifest.metadata.season === "number" ? manifest.metadata.season : null
                  const episode = typeof manifest.metadata.episode === "number" ? manifest.metadata.episode : null
                  navigate(season !== null && episode !== null ? { name: "watch", imdbId, season, episode } : { name: "watch", imdbId })
                }} />
              ))}
            </div>
          ) : <CollectionEmpty title="No downloads" description="Download a playing title to watch it without a connection." />}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
