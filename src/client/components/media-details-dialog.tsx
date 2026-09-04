import { Bookmark, BookmarkCheck, Play, Star } from "lucide-react"
import { useEffect, useId, useState } from "react"

import { AppLink } from "@/components/app-link"
import { MediaRail } from "@/components/media-rail"
import { ErrorState, PageSkeleton } from "@/components/page-state"
import { Scene } from "@/components/scene"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCatalogEpisodes, useCatalogTitle, useLibrary } from "@/hooks"
import { formatRating, formatRuntime } from "@/lib/format"
import type { Route } from "@/lib/router"
import type { EpisodeSummary, MediaDetails } from "../../shared/media"

/**
 * The immersive title view. Rendered by App whenever the route is /title/:id,
 * on top of whatever browse view was open before; closing navigates back.
 */
export function MediaDetailsDialog({ imdbId, onClose }: { imdbId: string; onClose: () => void }) {
  const details = useCatalogTitle(imdbId)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="xl" immersive closeLabel="Close title" className="sm:max-h-[94svh]" aria-busy={details.loading}>
        {details.loading ? (
          <>
            <DialogTitle className="sr-only">Loading title</DialogTitle>
            <DialogDescription className="sr-only">Title details are loading.</DialogDescription>
            <PageSkeleton variant="title" />
          </>
        ) : details.error || !details.data ? (
          <div className="grid flex-1 place-items-center p-6">
            <DialogTitle className="sr-only">Title unavailable</DialogTitle>
            <DialogDescription className="sr-only">The title could not be loaded.</DialogDescription>
            <ErrorState compact message={details.error ?? "This title could not be loaded."} onRetry={details.retry} />
          </div>
        ) : (
          <DetailsBody media={details.data} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailsBody({ media }: { media: MediaDetails }) {
  const library = useLibrary()
  const id = media.imdbId || media.id
  const isTv = media.mediaType === "tv"
  const [season, setSeason] = useState<number | null>(null)
  useEffect(() => {
    if (!isTv) return
    const first = media.seasons.find((item) => item.season > 0) ?? media.seasons[0]
    setSeason(first ? first.season : null)
  }, [isTv, media.seasons])
  const episodes = useCatalogEpisodes(isTv ? id : null, season)
  const inProgress = Object.values(library.progress).find((item) => item.imdbId === id && !item.completed && item.season !== null)
  const startRoute: Route = isTv
    ? { name: "watch", imdbId: id, season: inProgress?.season ?? season ?? 1, episode: inProgress?.episode ?? 1 }
    : { name: "watch", imdbId: id }
  const saved = library.isBookmarked(id)
  const backdrop = media.backdropUrl ?? media.posterUrl
  const rating = formatRating(media.rating)
  const votes = media.voteCount ? new Intl.NumberFormat("en", { notation: "compact" }).format(media.voteCount) : null
  const runtime = formatRuntime(media.runtimeMinutes)
  const facts = [
    ["Genres", media.genres.join(", ")],
    ["Country", media.countries.join(", ")],
    ["Language", media.languages.join(", ")],
    ["Metacritic", media.metacriticScore ? `${media.metacriticScore} / 100` : ""],
    ["Released", media.releaseDate ?? ""],
  ].filter(([, value]) => value)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <Scene image={backdrop} soft={!media.backdropUrl} tone="veil" priority className="flex min-h-[64svh] items-end sm:min-h-[32rem]">
        <div className="w-full px-5 pb-6 pt-32 sm:px-8 sm:pb-8">
          <div className="max-w-2xl">
            {media.genres.length ? <p className="genre-line">{media.genres.slice(0, 3).join(" · ")}</p> : null}
            <DialogTitle className="display-title mt-3">{media.title}</DialogTitle>
            <div className="meta-row mt-4">
              {rating ? <span className="font-semibold text-foreground"><Star className="size-3.5 fill-rating text-rating" aria-hidden="true" />{rating}{votes ? <span className="font-normal text-muted-foreground">({votes})</span> : null}</span> : null}
              {media.year ? <span>{media.year}{media.endYear && media.endYear !== media.year ? `–${media.endYear}` : ""}</span> : null}
              <span>{isTv ? "Series" : "Film"}</span>
              {runtime ? <span>{runtime}</span> : null}
              {media.certification ? <span>{media.certification}</span> : null}
            </div>
            <DialogDescription className="mt-4 text-[0.95rem] leading-relaxed text-foreground/85 sm:text-base">
              {media.overview ?? "No synopsis is available for this title yet."}
            </DialogDescription>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button asChild size="lg">
                <AppLink route={startRoute}>
                  <Play className="fill-current" aria-hidden="true" />
                  {inProgress ? `Resume S${inProgress.season} E${inProgress.episode}` : isTv ? `Play S${season ?? 1} E1` : "Play"}
                </AppLink>
              </Button>
              <Button size="lg" variant="outline" aria-pressed={saved} onClick={() => library.toggleBookmark(media)}>
                {saved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
                {saved ? "In library" : "Add to library"}
              </Button>
            </div>
          </div>
        </div>
      </Scene>

      <div className="space-y-10 px-5 py-8 sm:px-8 sm:py-10">
        {isTv && media.seasons.length ? (
          <section aria-labelledby="episodes-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="episodes-heading" className="section-title">Episodes</h3>
              <Select value={season !== null ? String(season) : undefined} onValueChange={(value) => setSeason(Number(value))}>
                <SelectTrigger aria-label="Season"><SelectValue placeholder="Season" /></SelectTrigger>
                <SelectContent>
                  {media.seasons.map((item) => <SelectItem key={item.season} value={String(item.season)}>{item.title ?? `Season ${item.season}`}{item.episodeCount ? ` · ${item.episodeCount} ep` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <EpisodeList imdbId={id} season={season} loading={episodes.loading} error={episodes.error} retry={episodes.retry} episodes={episodes.data?.results ?? []} progress={library.progress} />
          </section>
        ) : null}

        {media.cast.length ? (
          <section aria-labelledby="cast-heading">
            <h3 id="cast-heading" className="section-title">Cast</h3>
            <ul className="media-rail mt-4" data-inset="true" tabIndex={0} aria-label="Cast members">
              {media.cast.slice(0, 14).map((person) => (
                <li key={person.id} className="rail-card">
                  <div className="aspect-square overflow-hidden rounded-full bg-muted">
                    {person.imageUrl ? <img src={person.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                  </div>
                  <p className="mt-2 truncate text-center text-sm font-medium">{person.name}</p>
                  {person.character ? <p className="truncate text-center text-xs text-muted-foreground">{person.character}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {facts.length ? (
          <section aria-labelledby="facts-heading">
            <h3 id="facts-heading" className="section-title">Details</h3>
            <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[6.5rem_1fr] gap-3 border-b border-border/60 pb-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {media.similar.length ? <MediaRail inset title="More like this" items={media.similar} /> : null}
      </div>
    </div>
  )
}

function EpisodeList({ imdbId, season, loading, error, retry, episodes, progress }: { imdbId: string; season: number | null; loading: boolean; error: string | null; retry: () => void; episodes: EpisodeSummary[]; progress: Record<string, { progressFraction: number; completed: boolean }> }) {
  const listId = useId()
  if (loading) return <ul className="mt-4 space-y-2" aria-busy="true">{Array.from({ length: 4 }, (_, index) => <li key={index} className="skeleton h-20 rounded-lg" />)}</ul>
  if (error) return <div className="mt-4"><ErrorState compact message={error} onRetry={retry} /></div>
  if (!episodes.length) return <p className="mt-4 text-sm text-muted-foreground">No episodes are listed for this season.</p>
  return (
    <ol id={listId} className="mt-4 divide-y divide-border/60">
      {episodes.map((episode) => {
        const record = season !== null ? progress[`${imdbId}:s${season}:e${episode.episode}`] : undefined
        const pct = record ? Math.round(record.progressFraction * 100) : 0
        return (
          <li key={episode.id}>
            <AppLink
              route={{ name: "watch", imdbId, season: season ?? episode.season, episode: episode.episode }}
              className="group -mx-2 flex min-h-11 items-center gap-4 rounded-lg px-2 py-3 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="relative hidden aspect-video w-32 shrink-0 overflow-hidden rounded-md bg-muted sm:block">
                {episode.imageUrl ? <img src={episode.imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
                {pct > 0 ? <span className="absolute inset-x-0 bottom-0 h-1 bg-white/25"><span className="block h-full bg-white" style={{ width: `${pct}%` }} /></span> : null}
              </span>
              <span className="w-7 shrink-0 text-sm tabular-nums text-muted-foreground">{episode.episode}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold"><span className="truncate">{episode.title ?? `Episode ${episode.episode}`}</span>{record?.completed ? <Badge variant="muted">Watched</Badge> : pct > 0 ? <Badge variant="muted">{pct}%</Badge> : null}</span>
                {episode.overview ? <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">{episode.overview}</span> : null}
              </span>
              <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{episode.runtimeMinutes ? formatRuntime(episode.runtimeMinutes) : ""}</span>
              <Play className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
            </AppLink>
          </li>
        )
      })}
    </ol>
  )
}
