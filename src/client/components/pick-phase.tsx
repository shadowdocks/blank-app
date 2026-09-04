import * as React from "react"
import { ArrowRight, Loader2, Search } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group"
import { MOODS, TIMES, TYPES, type Option } from "@/lib/options"
import type { MediaType, TimeBucket } from "@/lib/types"

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-sm font-medium">
          {label}
        </h2>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Cards<T extends string>({ options }: { options: Option<T>[] }) {
  return (
    <>
      {options.map((option) => (
        <RadioGroupCard key={option.id} value={option.id} id={`option-${option.id}`}>
          <span className="text-sm font-medium">{option.name}</span>
          <span className="text-xs text-muted-foreground">{option.note}</span>
        </RadioGroupCard>
      ))}
    </>
  )
}

export function PickPhase({
  mood,
  type,
  time,
  pending,
  error,
  onMoodChange,
  onTypeChange,
  onTimeChange,
  onSubmit,
}: {
  mood: string
  type: MediaType
  time: TimeBucket
  pending: boolean
  error: string | null
  onMoodChange: (value: string) => void
  onTypeChange: (value: MediaType) => void
  onTimeChange: (value: TimeBucket) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="animate-rise space-y-8"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">What are you in the mood for?</h1>
        <p className="text-sm text-muted-foreground">
          Three choices, one title. Change your mind as often as you like.
        </p>
      </header>

      <Field id="field-mood" label="Mood">
        <RadioGroup
          aria-labelledby="field-mood"
          value={mood}
          onValueChange={onMoodChange}
          className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Cards options={MOODS} />
        </RadioGroup>
      </Field>

      <div className="grid gap-8 sm:grid-cols-2">
        <Field id="field-type" label="Format">
          <RadioGroup
            aria-labelledby="field-type"
            value={type}
            onValueChange={(value) => onTypeChange(value as MediaType)}
            className="grid-cols-2"
          >
            <Cards options={TYPES} />
          </RadioGroup>
        </Field>

        <Field id="field-time" label="Length">
          <RadioGroup
            aria-labelledby="field-time"
            value={time}
            onValueChange={(value) => onTimeChange(value as TimeBucket)}
            className="grid-cols-1 sm:grid-cols-3"
          >
            <Cards options={TIMES} />
          </RadioGroup>
        </Field>
      </div>

      {error ? <Notice>{error}</Notice> : null}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          )}
          {pending ? "Finding a title" : "Find something"}
        </Button>
        <Button asChild size="lg" variant="ghost">
          <AppLink route={{ name: "search" }}>
            <Search data-icon="inline-start" aria-hidden="true" />
            Search by name
          </AppLink>
        </Button>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {pending ? "Searching the catalogue." : ""}
        </p>
      </div>
    </form>
  )
}
