import { Bookmark, BookmarkCheck, Calendar, Clock, Play, Star } from "lucide-react"
import { useEffect, useState } from "react"

import { AppLink } from "@/components/app-link"
import { MediaRail } from "@/components/media-rail"
import { ErrorState, PageContainer, PageSkeleton } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCatalogEpisodes, useCatalogTitle, useLibrary } from "@/hooks"
import { formatRating, formatRuntime } from "@/lib/format"

export function TitlePage({ imdbId }: { imdbId: string }) {
  const title = useCatalogTitle(imdbId)
  const library = useLibrary()
  const [season, setSeason] = useState<number | null>(null)
  const episodes = useCatalogEpisodes(imdbId, season)

  useEffect(() => {
    if (title.data?.mediaType === "tv" && title.data.seasons.length && season === null) setSeason(title.data.seasons.find((item) => item.season > 0)?.season ?? title.data.seasons[0].season)
  }, [season, title.data])

  if (title.loading) return <PageSkeleton variant="title" />
  if (title.error || !title.data) return <ErrorState message={title.error ?? "This title is unavailable."} onRetry={title.retry} />
  const media = title.data
  const id = media.imdbId || media.id
  const bookmarked = library.isBookmarked(id)
  const votes = media.voteCount ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(media.voteCount) : null

  return <article className="animate-rise">
    <section className="title-hero relative min-h-[30rem] overflow-hidden border-b border-border">
      {media.backdropUrl || media.posterUrl ? <img src={media.backdropUrl ?? media.posterUrl ?? ""} alt="" fetchPriority="high" className={`absolute inset-0 h-full w-full object-cover ${media.backdropUrl ? "" : "scale-110 opacity-60 blur-2xl"}`} /> : null}<div className="hero-shade absolute inset-0" />
      <PageContainer className="relative flex min-h-[30rem] items-end pb-10 pt-24"><div className="grid w-full items-end gap-6 sm:grid-cols-[11rem_minmax(0,1fr)] lg:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="hidden aspect-2/3 overflow-hidden rounded-lg border border-white/10 bg-card shadow-2xl sm:block">{media.posterUrl ? <img src={media.posterUrl} alt={`${media.title} poster`} className="h-full w-full object-cover" /> : null}</div>
        <div className="max-w-3xl"><p className="eyebrow">{media.mediaType === "tv" ? "Series" : "Feature film"}</p><h1 className="mt-3 text-4xl font-semibold leading-tight tracking-[-0.05em] sm:text-5xl">{media.title}</h1><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground/80">{media.rating ? <span className="inline-flex items-center gap-1.5 font-semibold text-foreground"><Star className="size-4 fill-amber-400 text-amber-400" />{formatRating(media.rating)} IMDb {votes ? <span className="font-normal text-foreground/60">({votes} votes)</span> : null}</span> : null}{media.year ? <span className="inline-flex items-center gap-1.5"><Calendar className="size-4" />{media.endYear ? `${media.year}–${media.endYear}` : media.year}</span> : null}{media.runtimeMinutes ? <span className="inline-flex items-center gap-1.5"><Clock className="size-4" />{formatRuntime(media.runtimeMinutes)}</span> : null}{media.certification ? <span>{media.certification}</span> : null}</div>
          <div className="mt-7 flex flex-wrap gap-2"><Button asChild size="lg"><AppLink route={media.mediaType === "tv" ? { name: "watch", imdbId: id, season: season ?? 1, episode: 1 } : { name: "watch", imdbId: id }}><Play className="fill-current" />{media.mediaType === "tv" ? "Start series" : "Watch now"}</AppLink></Button><Button size="lg" variant="secondary" aria-pressed={bookmarked} onClick={() => library.toggleBookmark(media)}>{bookmarked ? <BookmarkCheck /> : <Bookmark />}{bookmarked ? "In library" : "Add to library"}</Button></div>
        </div>
      </div></PageContainer>
    </section>

    <PageContainer className="space-y-14 py-10 sm:py-14">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]"><div><p className="eyebrow">The story</p><h2 className="section-title mt-2">About {media.title}</h2><p className="mt-4 max-w-3xl text-base leading-7 text-foreground/75">{media.overview ?? "No synopsis is available for this title."}</p></div><dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-xl border border-border bg-card p-5 text-sm"><div><dt className="text-muted-foreground">Genres</dt><dd className="mt-1 font-medium">{media.genres.join(", ") || "Unknown"}</dd></div><div><dt className="text-muted-foreground">Country</dt><dd className="mt-1 font-medium">{media.countries.join(", ") || "Unknown"}</dd></div><div><dt className="text-muted-foreground">Language</dt><dd className="mt-1 font-medium">{media.languages.join(", ") || "Unknown"}</dd></div><div><dt className="text-muted-foreground">Metacritic</dt><dd className="mt-1 font-medium">{media.metacriticScore ?? "Not rated"}</dd></div></dl></section>

      {media.cast.length ? <section aria-labelledby="cast-heading"><p className="eyebrow">On screen</p><h2 id="cast-heading" className="section-title mt-2">Cast</h2><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{media.cast.slice(0, 12).map((person) => <article key={person.id} className="overflow-hidden rounded-lg border border-border bg-card"><div className="aspect-square bg-muted">{person.imageUrl ? <img src={person.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</div><div className="p-3"><h3 className="truncate text-sm font-semibold">{person.name}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{person.character ?? "Cast"}</p></div></article>)}</div></section> : null}

      {media.mediaType === "tv" && media.seasons.length ? <section aria-labelledby="episodes-heading"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">Episode guide</p><h2 id="episodes-heading" className="section-title mt-2">Seasons and episodes</h2></div><Select value={season === null ? undefined : String(season)} onValueChange={(value) => setSeason(Number(value))}><SelectTrigger aria-label="Choose season"><SelectValue placeholder="Season" /></SelectTrigger><SelectContent>{media.seasons.map((item) => <SelectItem key={item.season} value={String(item.season)}>{item.title || `Season ${item.season}`}</SelectItem>)}</SelectContent></Select></div>
        <div className="mt-5 divide-y divide-border rounded-xl border border-border bg-card">{episodes.loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className="flex gap-4 p-4"><div className="skeleton aspect-video w-32 rounded-md" /><div className="flex-1 space-y-2"><div className="skeleton h-4 w-2/3 rounded" /><div className="skeleton h-3 w-full rounded" /></div></div>) : episodes.error ? <div className="p-5"><ErrorState message={episodes.error} onRetry={episodes.retry} /></div> : episodes.data?.results.map((episode) => <AppLink key={episode.id} route={{ name: "watch", imdbId: id, season: episode.season, episode: episode.episode }} className="group grid min-h-24 grid-cols-[6rem_1fr_auto] items-center gap-4 p-3 outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[10rem_1fr_auto] sm:p-4"><div className="aspect-video overflow-hidden rounded-md bg-muted">{episode.imageUrl ? <img src={episode.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</div><div className="min-w-0"><p className="text-xs text-muted-foreground">Episode {episode.episode}</p><h3 className="mt-1 truncate font-semibold group-hover:text-primary">{episode.title}</h3><p className="mt-1 hidden line-clamp-1 text-sm text-muted-foreground sm:block">{episode.overview}</p></div><Play className="mr-2 size-5" aria-hidden="true" /></AppLink>)}</div>
      </section> : null}
    </PageContainer>
    {media.similar.length ? <div className="pb-14"><MediaRail title="More like this" eyebrow="Based on this title" items={media.similar} /></div> : null}
  </article>
}
