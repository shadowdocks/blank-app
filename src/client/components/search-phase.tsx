import { useState } from "react"
import { Clock, RotateCcw, Search, SearchX, X } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { EmptyState } from "@/components/empty-state"
import { Notice } from "@/components/notice"
import { Poster } from "@/components/poster"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { typeName } from "@/lib/options"
import { titleIdOf } from "@/lib/router"
import { clearRecentSearches, loadRecentSearches, saveRecentSearch } from "@/lib/storage"
import type { Title } from "@/lib/types"
import { MIN_QUERY, useSearch } from "@/lib/use-search"

function ResultCard({ title, onSelect }: { title: Title; onSelect: () => void }) {
  const meta = [title.year, title.mediaType ? typeName(title.mediaType) : null]
    .filter((part): part is string => Boolean(part))
    .join(" · ")

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group flex flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <Poster src={title.posterUrl} className="group-hover:border-input" />
      <span className="block min-w-0">
        <span className="line-clamp-2 block text-sm leading-snug font-medium">{title.title}</span>
        {meta ? <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span> : null}
      </span>
    </button>
  )
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="aspect-[2/3] w-full animate-pulse rounded-md border border-border bg-card" />
      <div className="h-3.5 w-4/5 animate-pulse rounded bg-card" />
      <div className="h-3 w-2/5 animate-pulse rounded bg-card" />
    </div>
  )
}

export function SearchPhase({
  query,
  onQueryChange,
  onSelect,
}: {
  query: string
  onQueryChange: (value: string) => void
  onSelect: (title: Title) => void
}) {
  const feed = useSearch(query)
  const [recent, setRecent] = useState<string[]>(loadRecentSearches)

  const trimmed = query.trim()
  const short = trimmed.length > 0 && trimmed.length < MIN_QUERY
  const empty = !feed.pending && !feed.error && trimmed.length >= MIN_QUERY && !feed.results.length

  const status = feed.pending
    ? "Searching."
    : short
      ? `Type at least ${MIN_QUERY} characters.`
      : feed.results.length
        ? `${feed.results.length} ${feed.results.length === 1 ? "result" : "results"} for "${trimmed}".`
        : ""

  const choose = (title: Title) => {
    setRecent(saveRecentSearch(trimmed))
    onSelect(title)
  }

  return (
    <section className="animate-rise space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Look up a film or series by name, then pick a source.
        </p>
      </header>

      <form role="search" className="space-y-2" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="search-query" className="sr-only">
          Search titles
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="search-query"
            type="search"
            name="q"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search titles"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="search-status"
            className="h-10 pr-10 pl-9 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <p id="search-status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
          {status}
        </p>
      </form>

      {feed.error ? (
        <Notice
          action={
            <Button size="sm" variant="secondary" onClick={feed.retry}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Try again
            </Button>
          }
        >
          {feed.error}
        </Notice>
      ) : null}

      {!trimmed && recent.length ? (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Recent searches</h2>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                clearRecentSearches()
                setRecent([])
              }}
            >
              Clear
            </Button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((item) => (
              <li key={item}>
                <Button size="sm" variant="secondary" onClick={() => onQueryChange(item)}>
                  <Clock data-icon="inline-start" aria-hidden="true" />
                  {item}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {feed.pending && !feed.results.length ? (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5"
          aria-busy="true"
        >
          {Array.from({ length: 10 }, (_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : null}

      {feed.results.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {feed.results.map((item, index) => (
            <li key={`${item.mediaType ?? "movie"}-${titleIdOf(item) ?? index}`}>
              <ResultCard title={item} onSelect={() => choose(item)} />
            </li>
          ))}
        </ul>
      ) : null}

      {empty ? (
        <EmptyState
          icon={SearchX}
          title={`No matches for "${trimmed}"`}
          description="Check the spelling, or try the original title instead of a translation."
        >
          <Button asChild size="sm" variant="secondary">
            <AppLink route={{ name: "pick" }}>Browse by mood</AppLink>
          </Button>
        </EmptyState>
      ) : null}

      {!trimmed && !recent.length ? (
        <EmptyState
          icon={Search}
          title="Start typing to search"
          description="Results appear as you type. Pick one to jump straight to its sources."
        />
      ) : null}
    </section>
  )
}
