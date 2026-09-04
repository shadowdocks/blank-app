import { AppLink } from "@/components/app-link"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import type { MediaSummary } from "../../shared/media"

/**
 * Poster card. It is a real link to /title/:imdbId, which App renders as the
 * details dialog on top of the current browse view. Artwork carries the card;
 * the only text is title, year and type.
 */
export function MediaCard({ media, progress, priority = false, className }: { media: MediaSummary; progress?: number; priority?: boolean; className?: string }) {
  const id = media.imdbId || media.id
  return (
    <article className={cn("group min-w-0", className)}>
      <AppLink
        route={{ name: "title", id, imdbId: id, type: media.mediaType }}
        aria-label={`${media.title}${media.year ? ` (${media.year})` : ""}`}
        className="block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-3 focus-visible:ring-offset-background"
      >
        <div className="poster-frame relative aspect-2/3 overflow-hidden rounded-lg bg-card transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5">
          {media.posterUrl ? (
            <img src={media.posterUrl} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" className="h-full w-full object-cover transition-[filter] duration-200 group-hover:brightness-110" />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">Artwork unavailable</div>
          )}
          {progress !== undefined && progress > 0 ? (
            <Progress value={progress * 100} aria-label={`${Math.round(progress * 100)}% watched`} className="absolute inset-x-0 bottom-0 h-1 rounded-none bg-black/60" />
          ) : null}
        </div>
        <div className="mt-2.5 min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight">{media.title}</h3>
          <p className="mt-0.5 flex gap-2 text-xs text-muted-foreground">
            <span>{media.year ?? "Year unknown"}</span>
            <span aria-hidden="true">·</span>
            <span>{media.mediaType === "tv" ? "Series" : "Film"}</span>
          </p>
        </div>
      </AppLink>
    </article>
  )
}

export function bookmarkToSummary(media: { imdbId: string; mediaType: "movie" | "tv"; title: string; year: number | null; rating: number | null; posterUrl: string | null; backdropUrl: string | null; genres: string[] }): MediaSummary {
  return { id: media.imdbId, imdbId: media.imdbId, tmdbId: null, mediaType: media.mediaType, title: media.title, originalTitle: null, year: media.year, endYear: null, rating: media.rating, voteCount: null, genres: media.genres, posterUrl: media.posterUrl, backdropUrl: media.backdropUrl }
}
