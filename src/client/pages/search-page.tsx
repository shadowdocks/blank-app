import { Search, X } from "lucide-react"
import { useEffect, useState } from "react"

import { MediaCard } from "@/components/media-card"
import { CollectionEmpty, ErrorState, PageContainer } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCatalogSearch, useLibrary } from "@/hooks"
import { clearRecentSearches, saveRecentSearch } from "@/lib/storage"

export function SearchPage() {
  const [query, setQuery] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(query.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [query])
  const results = useCatalogSearch(searchQuery)
  const library = useLibrary()
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (query.trim()) saveRecentSearch(query) }

  return <PageContainer className="py-8 sm:py-12">
    <div className="max-w-2xl"><p className="eyebrow">Find your next watch</p><h1 className="page-title">Search</h1><form className="relative mt-6" role="search" onSubmit={submit}><label htmlFor="catalog-search" className="sr-only">Search movies and series</label><Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input id="catalog-search" autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search movies and series" className="h-14 rounded-xl pl-12 pr-12 text-base" />{query ? <Button type="button" size="icon" variant="ghost" onClick={() => setQuery("")} className="absolute right-1.5 top-1.5" aria-label="Clear search"><X className="size-4" /></Button> : null}</form></div>

    {!searchQuery && library.recentSearches.length ? <section className="mt-10" aria-labelledby="recent-heading"><div className="flex items-center justify-between"><h2 id="recent-heading" className="section-title">Recent searches</h2><Button variant="ghost" onClick={clearRecentSearches}>Clear</Button></div><div className="mt-3 flex flex-wrap gap-2">{library.recentSearches.map((term) => <Button key={term} variant="outline" onClick={() => setQuery(term)}>{term}</Button>)}</div></section> : null}
    {searchQuery ? <section className="mt-10" aria-live="polite" aria-busy={results.loading}>{results.loading ? <div className="media-grid">{Array.from({ length: 10 }, (_, index) => <div key={index} className="skeleton aspect-2/3 rounded-lg" />)}</div> : results.error ? <ErrorState message={results.error} onRetry={results.retry} /> : results.data?.results.length ? <><div className="mb-5 flex items-baseline justify-between gap-4"><h2 className="section-title">Results for “{searchQuery}”</h2><span className="text-sm text-muted-foreground">{results.data.results.length} titles</span></div><div className="media-grid">{results.data.results.map((media) => <MediaCard key={`${media.mediaType}-${media.id}`} media={media} />)}</div></> : <CollectionEmpty title="No titles found" description={`Try another title or check the spelling of “${searchQuery}”.`} />}</section> : !library.recentSearches.length ? <div className="mt-10"><CollectionEmpty title="Search the catalogue" description="Enter a movie or series title to begin." /></div> : null}
  </PageContainer>
}
