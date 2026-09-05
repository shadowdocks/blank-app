import { ChevronLeft, ChevronRight, Info, Play, Star } from "lucide-react"
import * as React from "react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import { useRoute } from "@/hooks"
import { formatRating } from "@/lib/format"
import type { MediaSummary } from "../../shared/media"

export interface HeroResume {
  season: number | null
  episode: number | null
  fraction: number
}

const INTERVAL_MS = 9000
const SWIPE_PX = 48

/**
 * The opening stage as a restrained slider: sharp artwork inset in an ambient
 * wash at >= 64rem, full bleed below. Only opacity moves. The copy sits
 * low-left; a landscape filmstrip picks the title and sits beside the copy
 * from 80rem up, under it below that.
 *
 * Auto-advance pauses on hover, focus within, hidden document, offscreen,
 * reduced motion, and while the details dialog is open on top.
 */
export function HeroSlider({ heroes, activeIndex, onActiveIndexChange, resumeById }: {
  heroes: MediaSummary[]
  activeIndex: number
  onActiveIndexChange: (index: number) => void
  resumeById: Record<string, HeroResume>
}) {
  const route = useRoute()
  const count = heroes.length
  const active = heroes[activeIndex] ?? heroes[0]
  const nextIndex = (activeIndex + 1) % count
  const sectionRef = React.useRef<HTMLElement>(null)
  const stripRef = React.useRef<HTMLDivElement>(null)
  const touchRef = React.useRef<{ x: number; y: number } | null>(null)
  const changeRef = React.useRef(onActiveIndexChange)
  changeRef.current = onActiveIndexChange

  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const [visible, setVisible] = React.useState(true)
  const [visited, setVisited] = React.useState<ReadonlySet<number>>(() => new Set([0]))
  const hidden = useDocumentHidden()
  const reducedMotion = useReducedMotion()
  const dialogOpen = route.name === "title"
  const paused = count < 2 || hovered || focused || hidden || !visible || reducedMotion || dialogOpen

  const select = React.useCallback((index: number) => changeRef.current(((index % count) + count) % count), [count])

  React.useEffect(() => {
    if (paused) return
    const timer = window.setInterval(() => select(activeIndex + 1), INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [paused, activeIndex, select])

  React.useEffect(() => {
    setVisited((prev) => (prev.has(activeIndex) ? prev : new Set(prev).add(activeIndex)))
    const thumb = stripRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    thumb?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion ? "auto" : "smooth" })
  }, [activeIndex, reducedMotion])

  React.useEffect(() => {
    const node = sectionRef.current
    if (!node || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { threshold: 0.3 })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (count < 2) return
    if (event.key === "ArrowRight") { event.preventDefault(); select(activeIndex + 1) }
    if (event.key === "ArrowLeft") { event.preventDefault(); select(activeIndex - 1) }
  }
  const onTouchStart = (event: React.TouchEvent) => {
    const touch = event.touches[0]
    touchRef.current = touch && !(event.target as Element).closest(".hero-strip") ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchRef.current
    const touch = event.changedTouches[0]
    touchRef.current = null
    if (!start || !touch || count < 2) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return
    select(dx < 0 ? activeIndex + 1 : activeIndex - 1)
  }

  const id = active.imdbId || active.id
  const resume = resumeById[id]
  const titleRoute = { name: "title", id, imdbId: id, type: active.mediaType } as const
  const watchRoute = active.mediaType === "tv"
    ? { name: "watch", imdbId: id, season: resume?.season ?? 1, episode: resume?.episode ?? 1 } as const
    : { name: "watch", imdbId: id } as const
  const rating = formatRating(active.rating)
  const ambient = active.backdropUrl ?? active.posterUrl

  return (
    <section
      ref={sectionRef}
      className="scene hero-stage"
      aria-roledescription={count > 1 ? "carousel" : undefined}
      aria-labelledby="stage-title"
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true) }}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false) }}
      onKeyDown={onKeyDown}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { touchRef.current = null }}
    >
      {ambient ? <img src={ambient} alt="" className="scene-art" data-ambient="true" loading="lazy" decoding="async" aria-hidden="true" /> : null}
      <div className="stage-frame flex min-h-[64svh] items-end sm:min-h-[60svh] lg:min-h-[34rem] lg:max-h-[46rem] lg:aspect-[21/10]">
        {heroes.map((media, index) => {
          const isActive = index === activeIndex
          const isNext = count > 1 && index === nextIndex
          if (!isActive && !isNext && !visited.has(index)) return null
          const src = media.backdropUrl ?? media.posterUrl
          if (!src) return null
          return (
            <img
              key={`${media.mediaType}-${media.id}`}
              src={src}
              alt=""
              className="scene-art hero-art"
              data-active={isActive ? "true" : "false"}
              data-soft={media.backdropUrl ? undefined : "true"}
              loading={isActive || isNext ? "eager" : "lazy"}
              fetchPriority={isActive ? "high" : isNext ? "low" : "auto"}
              decoding="async"
              aria-hidden="true"
            />
          )
        })}
        <div className="scene-shade" aria-hidden="true" />
        <div className="hero-copy w-full px-4 pb-6 sm:px-8 sm:pb-8 lg:px-12 lg:pb-10">
          <div
            key={`${active.mediaType}-${active.id}`}
            className="animate-fade min-w-0 max-w-xl"
            role={count > 1 ? "group" : undefined}
            aria-roledescription={count > 1 ? "slide" : undefined}
            aria-label={count > 1 ? `${activeIndex + 1} of ${count}` : undefined}
            aria-live={paused && count > 1 ? "polite" : "off"}
          >
            {active.genres.length ? <p className="genre-line">{active.genres.slice(0, 3).join(" · ")}</p> : null}
            <h1 id="stage-title" className="display-title mt-3">{active.title}</h1>
            <div className="meta-row mt-4">
              {rating ? <span className="font-semibold text-foreground"><Star className="size-3.5 fill-rating text-rating" aria-hidden="true" />{rating}</span> : null}
              {active.year ? <span>{active.year}{active.endYear && active.endYear !== active.year ? `–${active.endYear}` : ""}</span> : null}
              <span>{active.mediaType === "tv" ? "Series" : "Film"}</span>
              {resume && active.mediaType === "tv" && resume.season !== null && resume.episode !== null ? <span>S{resume.season} E{resume.episode}</span> : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button asChild size="lg"><AppLink route={watchRoute}><Play className="fill-current" aria-hidden="true" />{resume ? "Resume" : "Play"}</AppLink></Button>
              <Button asChild size="lg" variant="outline"><AppLink route={titleRoute}><Info aria-hidden="true" />Details</AppLink></Button>
            </div>
          </div>

          {count > 1 ? (
            <div className="hero-strip-row mt-6 flex min-w-0 items-center gap-2 xl:mt-0">
              <Button size="icon" variant="ghost" className="hidden shrink-0 sm:inline-flex" onClick={() => select(activeIndex - 1)} aria-label="Previous featured title"><ChevronLeft /></Button>
              <div ref={stripRef} className="hero-strip" role="group" aria-label="Featured titles">
                {heroes.map((media, index) => {
                  const thumb = media.backdropUrl ?? media.posterUrl
                  const isActive = index === activeIndex
                  return (
                    <button
                      key={`${media.mediaType}-${media.id}`}
                      type="button"
                      className="hero-thumb"
                      aria-label={`Show ${media.title}`}
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => select(index)}
                    >
                      {thumb ? <img src={thumb} alt="" loading={isActive || index === nextIndex ? "eager" : "lazy"} decoding="async" /> : <span className="flex h-full items-center justify-center px-1 text-center text-[10px] leading-tight text-muted-foreground">{media.title}</span>}
                    </button>
                  )
                })}
              </div>
              <Button size="icon" variant="ghost" className="hidden shrink-0 sm:inline-flex" onClick={() => select(activeIndex + 1)} aria-label="Next featured title"><ChevronRight /></Button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function useDocumentHidden() {
  return React.useSyncExternalStore(
    (onChange) => { document.addEventListener("visibilitychange", onChange); return () => document.removeEventListener("visibilitychange", onChange) },
    () => document.visibilityState === "hidden",
    () => false
  )
}

function useReducedMotion() {
  return React.useSyncExternalStore(
    (onChange) => { const query = window.matchMedia("(prefers-reduced-motion: reduce)"); query.addEventListener("change", onChange); return () => query.removeEventListener("change", onChange) },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  )
}
