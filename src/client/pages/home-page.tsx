import { Info, Play, Star } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { MediaRail } from "@/components/media-rail"
import { ErrorState, PageSkeleton } from "@/components/page-state"
import { Scene } from "@/components/scene"
import { Button } from "@/components/ui/button"
import { useCatalogHome, useLibrary } from "@/hooks"
import { formatRating } from "@/lib/format"
import type { MediaSummary } from "../../shared/media"

export function HomePage() {
  const catalog = useCatalogHome()
  const library = useLibrary()
  if (catalog.loading) return <PageSkeleton variant="stage" />
  if (catalog.error || !catalog.data) return <ErrorState message={catalog.error ?? "The catalogue is unavailable."} onRetry={catalog.retry} />
  const hero = catalog.data.hero
  const progressById = Object.fromEntries(Object.values(library.progress).map((item) => [item.imdbId, item.progressFraction]))
  const seen = new Set<string>()
  const continueItems = library.history.filter((record) => {
    const id = record.media.imdbId || record.media.id
    const progress = library.progress[record.season !== null && record.episode !== null ? `${id}:s${record.season}:e${record.episode}` : id]
    if (!progress || progress.completed || seen.has(id)) return false
    seen.add(id)
    return true
  }).map((record) => record.media)

  return (
    <div className="animate-fade">
      {hero ? <Stage media={hero} /> : <div className="h-16" />}
      <div className="space-y-10 py-8 sm:space-y-12 sm:py-10">
        {continueItems.length ? <MediaRail title="Continue watching" items={continueItems} progressById={progressById} /> : null}
        {catalog.data.sections.map((section) => <MediaRail key={section.id} title={section.title} items={section.items} />)}
      </div>
    </div>
  )
}

/**
 * The opening stage: sharp artwork inset in an ambient wash at >= 1024, full
 * bleed below. Copy sits low-left and leaves the right two thirds to the image.
 */
function Stage({ media }: { media: MediaSummary }) {
  const id = media.imdbId || media.id
  const titleRoute = { name: "title", id, imdbId: id, type: media.mediaType } as const
  const watchRoute = media.mediaType === "tv" ? { name: "watch", imdbId: id, season: 1, episode: 1 } as const : { name: "watch", imdbId: id } as const
  const rating = formatRating(media.rating)
  return (
    <Scene
      stage
      image={media.backdropUrl ?? media.posterUrl}
      soft={!media.backdropUrl}
      priority
      aria-labelledby="stage-title"
      className="lg:pt-20"
      frameClassName="flex min-h-[64svh] items-end sm:min-h-[60svh] lg:min-h-[34rem] lg:max-h-[46rem] lg:aspect-[21/10]"
    >
      <div className="w-full px-4 pb-8 pt-32 sm:px-8 sm:pb-10 lg:px-12 lg:pb-12">
        <div className="max-w-xl lg:max-w-2xl">
          {media.genres.length ? <p className="genre-line">{media.genres.slice(0, 3).join(" · ")}</p> : null}
          <h1 id="stage-title" className="display-title mt-3">{media.title}</h1>
          <div className="meta-row mt-4">
            {rating ? <span className="font-semibold text-foreground"><Star className="size-3.5 fill-rating text-rating" aria-hidden="true" />{rating}</span> : null}
            {media.year ? <span>{media.year}{media.endYear && media.endYear !== media.year ? `–${media.endYear}` : ""}</span> : null}
            <span>{media.mediaType === "tv" ? "Series" : "Film"}</span>
          </div>
          <div className="mt-6 flex flex-wrap gap-2.5">
            <Button asChild size="lg"><AppLink route={watchRoute}><Play className="fill-current" aria-hidden="true" />Play</AppLink></Button>
            <Button asChild size="lg" variant="outline"><AppLink route={titleRoute}><Info aria-hidden="true" />Details</AppLink></Button>
          </div>
        </div>
      </div>
    </Scene>
  )
}
