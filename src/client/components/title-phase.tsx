import { ArrowLeft, Clock, Loader2, RefreshCw, Star } from "lucide-react"

import { Notice } from "@/components/notice"
import { Poster } from "@/components/poster"
import { Button } from "@/components/ui/button"
import { formatRating, formatRuntime } from "@/lib/format"
import { typeName } from "@/lib/options"
import type { MediaType, Title } from "@/lib/types"

/** Shown while a shared or refreshed link hydrates through api/title. */
export function TitleSkeleton() {
  return (
    <div
      className="grid gap-6 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-8"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading title.</span>
      <div className="aspect-[2/3] w-32 animate-pulse rounded-md border border-border bg-card sm:w-full" />
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-card" />
        <div className="h-7 w-3/4 animate-pulse rounded bg-card" />
        <div className="h-3 w-40 animate-pulse rounded bg-card" />
        <div className="h-3 w-full animate-pulse rounded bg-card" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-card" />
      </div>
    </div>
  )
}

export function TitlePhase({
  title,
  type,
  pending,
  shuffling,
  error,
  onFindSources,
  onShuffle,
  onBack,
}: {
  title: Title
  type: MediaType
  pending: boolean
  shuffling: boolean
  error: string | null
  onFindSources: () => void
  onShuffle: () => void
  onBack: () => void
}) {
  const rating = formatRating(title.rating)
  const runtime = formatRuntime(title.runtime)
  const genres = (title.genres ?? []).slice(0, 3)

  return (
    <article className="animate-rise space-y-8">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)] sm:gap-8">
        <Poster src={title.posterUrl} className="w-32 sm:w-full" />

        <div className="min-w-0 space-y-4">
          <div className="space-y-2">
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {typeName(title.mediaType ?? type)}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              {title.title}
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {title.year ? <span>{title.year}</span> : null}
              {rating ? (
                <span className="flex items-center gap-1">
                  <Star className="size-3.5 text-primary" aria-hidden="true" />
                  {rating}
                </span>
              ) : null}
              {runtime ? (
                <span className="flex items-center gap-1">
                  <Clock className="size-3.5" aria-hidden="true" />
                  {runtime}
                </span>
              ) : null}
              {genres.length ? <span>{genres.join(", ")}</span> : null}
            </div>
          </div>

          {title.overview ? (
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
              {title.overview}
            </p>
          ) : null}

          {error ? <Notice>{error}</Notice> : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="lg" onClick={onFindSources} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              {pending ? "Finding sources" : "Find sources"}
            </Button>
            <Button size="lg" variant="secondary" onClick={onShuffle} disabled={shuffling}>
              <RefreshCw
                data-icon="inline-start"
                className={shuffling ? "animate-spin" : undefined}
                aria-hidden="true"
              />
              Another pick
            </Button>
            <Button size="lg" variant="ghost" onClick={onBack}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Change mood
            </Button>
          </div>
        </div>
      </div>
    </article>
  )
}
