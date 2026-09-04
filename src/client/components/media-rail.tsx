import { ChevronLeft, ChevronRight } from "lucide-react"
import { useRef } from "react"

import { MediaCard } from "@/components/media-card"
import { Button } from "@/components/ui/button"
import type { MediaSummary } from "../../shared/media"

export function MediaRail({ title, eyebrow, items, progressById }: { title: string; eyebrow?: string; items: MediaSummary[]; progressById?: Record<string, number> }) {
  const railRef = useRef<HTMLDivElement>(null)
  const scroll = (direction: number) => railRef.current?.scrollBy({ left: direction * railRef.current.clientWidth * 0.82, behavior: "smooth" })
  if (!items.length) return null
  return (
    <section className="rail-section" aria-labelledby={`rail-${title.replace(/\s/g, "-")}`}>
      <div className="page-container mb-4 flex items-end justify-between gap-4">
        <div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h2 id={`rail-${title.replace(/\s/g, "-")}`} className="section-title">{title}</h2></div>
        <div className="hidden gap-1 sm:flex"><Button size="icon" variant="ghost" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ChevronLeft /></Button><Button size="icon" variant="ghost" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ChevronRight /></Button></div>
      </div>
      <div ref={railRef} className="media-rail page-gutter" tabIndex={0} aria-label={`${title} titles`}>
        {items.map((media) => <div key={`${media.mediaType}-${media.id}`} className="rail-card"><MediaCard media={media} progress={progressById?.[media.imdbId || media.id]} /></div>)}
      </div>
    </section>
  )
}
