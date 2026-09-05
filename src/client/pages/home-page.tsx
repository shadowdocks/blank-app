import { useState } from "react"

import { ContinueRow } from "@/components/continue-row"
import { HeroSlider, type HeroResume } from "@/components/hero-slider"
import { MediaRail } from "@/components/media-rail"
import { ErrorState, PageSkeleton } from "@/components/page-state"
import { useCatalogHome, useLibrary } from "@/hooks"
import type { CatalogHome, MediaSummary } from "../../shared/media"

const MAX_HEROES = 6

/** Up to six distinct heroes; older catalog payloads only carry `hero`. */
function pickHeroes(home: CatalogHome): MediaSummary[] {
  const candidates: (MediaSummary | null)[] = home.heroes?.length ? home.heroes : [home.hero]
  const seen = new Set<string>()
  const heroes: MediaSummary[] = []
  for (const media of candidates) {
    if (!media) continue
    const key = media.imdbId || media.id
    if (seen.has(key)) continue
    seen.add(key)
    heroes.push(media)
    if (heroes.length === MAX_HEROES) break
  }
  return heroes
}

export function HomePage() {
  const catalog = useCatalogHome()
  const library = useLibrary()
  const [activeIndex, setActiveIndex] = useState(0)
  if (catalog.loading) return <PageSkeleton variant="stage" />
  if (catalog.error || !catalog.data) return <ErrorState message={catalog.error ?? "The catalogue is unavailable."} onRetry={catalog.retry} />

  const heroes = pickHeroes(catalog.data)
  const heroIndex = Math.min(activeIndex, Math.max(0, heroes.length - 1))
  const activeHero = heroes[heroIndex] ?? null
  const activeId = activeHero ? activeHero.imdbId || activeHero.id : null
  const heroIds = new Set(heroes.map((media) => media.imdbId || media.id))

  const progressById = Object.fromEntries(Object.values(library.progress).map((item) => [item.imdbId, item.progressFraction]))
  const seen = new Set<string>()
  const resumeById: Record<string, HeroResume> = {}
  const continueRecords = library.history.filter((record) => {
    const id = record.media.imdbId || record.media.id
    const progress = library.progress[record.season !== null && record.episode !== null ? `${id}:s${record.season}:e${record.episode}` : id]
    if (!progress || progress.completed || seen.has(id)) return false
    seen.add(id)
    resumeById[id] = { season: record.season, episode: record.episode, fraction: progress.progressFraction }
    return true
  })
  const sole = continueRecords.length === 1 ? continueRecords[0]! : null
  const soleId = sole ? sole.media.imdbId || sole.media.id : null
  // Keep rails stable while the hero rotates. Removing only the active hero
  // mutates card identities every nine seconds and can move a scrolled rail.
  const notInHero = (media: MediaSummary) => !heroIds.has(media.imdbId || media.id)

  return (
    <div className="animate-fade">
      {activeHero ? <HeroSlider heroes={heroes} activeIndex={heroIndex} onActiveIndexChange={setActiveIndex} resumeById={resumeById} /> : <div className="h-16" />}
      <div className="space-y-10 py-8 sm:space-y-12 sm:py-10">
        {sole && soleId ? (soleId === activeId ? null : <ContinueRow media={sole.media} season={sole.season} episode={sole.episode} fraction={resumeById[soleId]?.fraction ?? 0} />)
          : continueRecords.length ? <MediaRail title="Continue watching" items={continueRecords.map((record) => record.media)} progressById={progressById} />
          : null}
        {catalog.data.sections.map((section) => <MediaRail key={section.id} title={section.title} items={section.items.filter(notInHero)} />)}
      </div>
    </div>
  )
}
