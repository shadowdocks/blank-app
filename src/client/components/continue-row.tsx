import { Info, Play } from "lucide-react"
import { useId } from "react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import type { MediaSummary } from "../../shared/media"

/**
 * Compact single-item Continue Watching: one row with a small poster, the
 * title, where you are, and Resume. Used instead of a rail that would hold
 * one card and a lot of nothing.
 */
export function ContinueRow({ media, season, episode, fraction }: { media: MediaSummary; season: number | null; episode: number | null; fraction: number }) {
  const headingId = useId()
  const id = media.imdbId || media.id
  const percent = Math.round(fraction * 100)
  const watchRoute = media.mediaType === "tv" && season !== null && episode !== null
    ? { name: "watch", imdbId: id, season, episode } as const
    : { name: "watch", imdbId: id } as const
  const titleRoute = { name: "title", id, imdbId: id, type: media.mediaType } as const
  const where = [media.mediaType === "tv" && season !== null && episode !== null ? `S${season} E${episode}` : null, media.year, `${percent}% watched`].filter(Boolean).join(" · ")

  return (
    <section className="page-container" aria-labelledby={headingId}>
      <h2 id={headingId} className="section-title mb-3">Continue watching</h2>
      <div className="surface flex flex-wrap items-center gap-4 p-3 sm:p-4">
        <AppLink route={titleRoute} aria-label={`${media.title} details`} className="poster-frame block aspect-2/3 w-14 shrink-0 overflow-hidden rounded-md bg-card outline-none focus-visible:ring-3 focus-visible:ring-ring sm:w-16">
          {media.posterUrl ? <img src={media.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : null}
        </AppLink>
        <div className="min-w-0 flex-1 basis-40">
          <h3 className="truncate text-base font-semibold tracking-tight">{media.title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{where}</p>
          <Progress value={percent} aria-label={`${percent}% watched`} className="mt-2.5 h-1 max-w-xs bg-black/50" />
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button asChild className="flex-1 sm:flex-none"><AppLink route={watchRoute}><Play className="fill-current" aria-hidden="true" />Resume</AppLink></Button>
          <Button asChild variant="ghost" className="flex-1 sm:flex-none"><AppLink route={titleRoute}><Info aria-hidden="true" />Details</AppLink></Button>
        </div>
      </div>
    </section>
  )
}
