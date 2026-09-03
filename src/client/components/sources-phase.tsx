import { ArrowLeft, Loader2, Play, RotateCcw, Users } from "lucide-react"

import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group"
import type { Source } from "@/lib/types"

function SkeletonRow() {
  return (
    <div className="h-[62px] animate-pulse rounded-md border border-border bg-card" aria-hidden="true" />
  )
}

export function SourcesPhase({
  titleName,
  sources,
  selectedMagnet,
  pending,
  starting,
  error,
  onSelect,
  onStart,
  onRetry,
  onBack,
}: {
  titleName: string
  sources: Source[]
  selectedMagnet: string | null
  pending: boolean
  starting: boolean
  error: string | null
  onSelect: (magnet: string) => void
  onStart: () => void
  onRetry: () => void
  onBack: () => void
}) {
  const empty = !pending && !error && sources.length === 0

  return (
    <section className="animate-rise space-y-6">
      <header className="space-y-1">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">Sources</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{titleName}</h1>
        <p className="text-sm text-muted-foreground">
          More seeds usually means a faster, steadier stream.
        </p>
      </header>

      {error ? (
        <Notice
          action={
            <Button size="sm" variant="secondary" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}

      {pending ? (
        <div className="space-y-2" aria-busy="true" aria-live="polite">
          <span className="sr-only">Searching for sources.</span>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-md border border-border bg-card px-4 py-8 text-center">
          <p className="text-sm font-medium">No sources found</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Nothing is seeding this title right now. Try again, or go back and pick another.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={onRetry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Search again
            </Button>
            <Button size="sm" variant="ghost" onClick={onBack}>
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Back to title
            </Button>
          </div>
        </div>
      ) : null}

      {sources.length ? (
        <RadioGroup
          aria-label={`Sources for ${titleName}`}
          value={selectedMagnet ?? ""}
          onValueChange={onSelect}
        >
          {sources.map((source) => (
            <RadioGroupCard key={source.magnet} value={source.magnet} className="gap-1.5">
              <span className="w-full truncate text-sm font-medium" title={source.name}>
                {source.name}
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" aria-hidden="true" />
                  {source.seeds} seeds
                </span>
                <span>{source.size}</span>
                <span className="uppercase">{source.source}</span>
              </span>
            </RadioGroupCard>
          ))}
        </RadioGroup>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={onStart} disabled={!selectedMagnet || starting}>
          {starting ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Play data-icon="inline-start" aria-hidden="true" />
          )}
          {starting ? "Starting" : "Start stream"}
        </Button>
        <Button size="lg" variant="ghost" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back to title
        </Button>
      </div>
    </section>
  )
}
