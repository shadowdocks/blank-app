import { useState } from "react"
import { ArrowLeft, Link2, Loader2, Play, RotateCcw, Users } from "lucide-react"

import { EmptyState } from "@/components/empty-state"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group"
import type { Source } from "@/lib/types"

const MAGNET_PREFIX = "magnet:?"

function SkeletonRow() {
  return (
    <div
      className="h-[62px] animate-pulse rounded-md border border-border bg-card"
      aria-hidden="true"
    />
  )
}

/** Power-user escape hatch: start a stream from a magnet the user already has. */
function MagnetForm({
  starting,
  onStart,
}: {
  starting: boolean
  onStart: (magnet: string) => void
}) {
  const [magnet, setMagnet] = useState("")
  const [invalid, setInvalid] = useState(false)

  return (
    <form
      className="space-y-3 rounded-md border border-border px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault()
        const value = magnet.trim()
        if (!value.toLowerCase().startsWith(MAGNET_PREFIX)) {
          setInvalid(true)
          return
        }
        setInvalid(false)
        onStart(value)
      }}
    >
      <div className="space-y-1">
        <label htmlFor="magnet-url" className="text-sm font-medium">
          Magnet URL
        </label>
        <p id="magnet-hint" className="text-xs text-muted-foreground">
          Optional. Paste a magnet link to stream it directly, skipping the list above.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="magnet-url"
          name="magnet"
          value={magnet}
          onChange={(event) => {
            setMagnet(event.target.value)
            if (invalid) setInvalid(false)
          }}
          placeholder="magnet:?xt=urn:btih:..."
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "magnet-hint magnet-error" : "magnet-hint"}
          className="font-mono text-xs sm:text-sm"
        />
        <Button
          type="submit"
          size="lg"
          variant="secondary"
          className="sm:shrink-0"
          disabled={starting || !magnet.trim()}
        >
          <Link2 data-icon="inline-start" aria-hidden="true" />
          Start magnet
        </Button>
      </div>

      {invalid ? (
        <p id="magnet-error" role="alert" className="text-xs text-destructive">
          That is not a magnet link. It has to start with {MAGNET_PREFIX}
        </p>
      ) : null}
    </form>
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
  onStart: (magnet: string) => void
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
        <EmptyState
          title="No sources found"
          description="Nothing is seeding this title right now. Try again, go back and pick another, or paste a magnet link below."
        >
          <Button size="sm" onClick={onRetry}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Search again
          </Button>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Back to title
          </Button>
        </EmptyState>
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
        <Button
          size="lg"
          onClick={() => selectedMagnet && onStart(selectedMagnet)}
          disabled={!selectedMagnet || starting}
        >
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

      <MagnetForm starting={starting} onStart={onStart} />
    </section>
  )
}
