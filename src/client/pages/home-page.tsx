import { Play, Star } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { MediaRail } from "@/components/media-rail"
import { ErrorState, PageContainer, PageSkeleton } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { useCatalogHome, useLibrary } from "@/hooks"
import type { MediaSummary } from "../../shared/media"

export function HomePage() {
  const catalog = useCatalogHome()
  const library = useLibrary()
  if (catalog.loading) return <PageSkeleton />
  if (catalog.error || !catalog.data) return <ErrorState message={catalog.error ?? "The catalogue is unavailable."} onRetry={catalog.retry} />
  const hero = catalog.data.hero
  const progressById = Object.fromEntries(Object.values(library.progress).map((item) => [item.imdbId, item.progressFraction]))
  const continueItems = library.history.filter((record) => {
    const progress = library.progress[record.season !== null && record.episode !== null ? `${record.media.imdbId || record.media.id}:s${record.season}:e${record.episode}` : record.media.imdbId || record.media.id]
    return progress && !progress.completed
  }).map((record) => record.media)

  return <div className="animate-rise">
    {hero ? <Hero media={hero} /> : null}
    <div className="space-y-12 py-10 sm:space-y-16 sm:py-14">
      {continueItems.length ? <MediaRail title="Continue watching" eyebrow="Pick up where you left off" items={continueItems} progressById={progressById} /> : null}
      {catalog.data.sections.map((section) => <MediaRail key={section.id} title={section.title} eyebrow="IMDb picks" items={section.items} />)}
    </div>
  </div>
}

function Hero({ media }: { media: MediaSummary }) {
  const id = media.imdbId || media.id
  const heroImage = media.backdropUrl ?? media.posterUrl
  return <section className="hero relative min-h-[34rem] overflow-hidden border-b border-border sm:min-h-[38rem]" aria-labelledby="featured-title">
    {heroImage ? <img src={heroImage} alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover object-center" /> : null}
    <div className="hero-shade absolute inset-0" />
    <PageContainer className="relative flex min-h-[34rem] items-end pb-10 pt-24 sm:min-h-[38rem] sm:pb-14">
      <div className="max-w-2xl"><p className="eyebrow">Featured tonight</p><h1 id="featured-title" className="mt-3 max-w-xl text-4xl font-semibold leading-[1.02] tracking-[-0.05em] sm:text-5xl">{media.title}</h1><div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-foreground/80">{media.rating ? <span className="flex items-center gap-1 font-semibold text-foreground"><Star className="size-4 fill-amber-400 text-amber-400" />{media.rating.toFixed(1)} IMDb</span> : null}<span>{media.year}</span><span>{media.mediaType === "tv" ? "Series" : "Movie"}</span>{media.genres.slice(0, 2).map((genre) => <span key={genre}>{genre}</span>)}</div><div className="mt-7"><Button asChild size="lg"><AppLink route={{ name: "title", id, imdbId: id, type: media.mediaType }}><Play className="fill-current" aria-hidden="true" />View title</AppLink></Button></div></div>
    </PageContainer>
  </section>
}
