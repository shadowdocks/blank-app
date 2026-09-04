import { Star } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Progress } from "@/components/ui/progress"
import type { MediaSummary } from "../../shared/media"

export function MediaCard({ media, progress, priority = false }: { media: MediaSummary; progress?: number; priority?: boolean }) {
  const id = media.imdbId || media.id
  return (
    <article className="group min-w-0">
      <AppLink route={{ name: "title", id, imdbId: id, type: media.mediaType }} className="block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-3 focus-visible:ring-offset-background">
        <div className="poster-frame relative aspect-2/3 overflow-hidden rounded-lg bg-card">
          {media.posterUrl ? <img src={media.posterUrl} alt="" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} className="h-full w-full object-cover transition duration-300 group-hover:brightness-110" /> : <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">Artwork unavailable</div>}
          {media.rating ? <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/85 px-2 py-1 text-xs font-semibold text-white"><Star className="size-3 fill-amber-400 text-amber-400" aria-hidden="true" />{media.rating.toFixed(1)}</span> : null}
          {progress !== undefined && progress > 0 ? <Progress value={progress * 100} aria-label={`${Math.round(progress * 100)}% watched`} className="absolute inset-x-0 bottom-0 h-1 rounded-none bg-black/60" /> : null}
        </div>
        <div className="mt-3 min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight group-hover:text-primary">{media.title}</h3>
          <p className="mt-1 flex gap-2 text-xs text-muted-foreground"><span>{media.year ?? "Year unknown"}</span><span aria-hidden="true">·</span><span>{media.mediaType === "tv" ? "Series" : "Movie"}</span></p>
        </div>
      </AppLink>
    </article>
  )
}

export function bookmarkToSummary(media: { imdbId: string; mediaType: "movie" | "tv"; title: string; year: number | null; rating: number | null; posterUrl: string | null; backdropUrl: string | null; genres: string[] }): MediaSummary {
  return { id: media.imdbId, imdbId: media.imdbId, tmdbId: null, mediaType: media.mediaType, title: media.title, originalTitle: null, year: media.year, endYear: null, rating: media.rating, voteCount: null, genres: media.genres, posterUrl: media.posterUrl, backdropUrl: media.backdropUrl }
}
