import { ChevronLeft, ChevronRight } from "lucide-react"
import { useId, useRef } from "react"

import { MediaCard } from "@/components/media-card"
import { Button } from "@/components/ui/button"
import type { MediaSummary } from "../../shared/media"

/**
 * Horizontal poster rail. `inset` keeps the rail inside its parent (used in the
 * details dialog); otherwise it bleeds to the viewport edge with page gutters.
 */
export function MediaRail({ title, description, items, progressById, inset = false }: { title: string; description?: string; items: MediaSummary[]; progressById?: Record<string, number>; inset?: boolean }) {
  const railRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const scroll = (direction: number) => railRef.current?.scrollBy({ left: direction * railRef.current.clientWidth * 0.82, behavior: "smooth" })
  if (!items.length) return null
  return (
    <section className="rail-section" aria-labelledby={headingId}>
      <div className={`${inset ? "" : "page-container "}mb-3 flex items-end justify-between gap-4`}>
        <div>
          <h2 id={headingId} className="section-title">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="hidden gap-1 sm:flex">
          <Button size="icon" variant="ghost" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ChevronLeft /></Button>
          <Button size="icon" variant="ghost" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ChevronRight /></Button>
        </div>
      </div>
      <div ref={railRef} className={`media-rail ${inset ? "" : "page-gutter"}`} data-inset={inset ? "true" : undefined} tabIndex={0} aria-label={`${title} titles`}>
        {items.map((media) => (
          <div key={`${media.mediaType}-${media.id}`} className="rail-card">
            <MediaCard media={media} progress={progressById?.[media.imdbId || media.id]} />
          </div>
        ))}
      </div>
    </section>
  )
}
