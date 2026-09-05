import { ChevronLeft, ChevronRight } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"

import { MediaCard } from "@/components/media-card"
import { Button } from "@/components/ui/button"
import type { MediaSummary } from "../../shared/media"

/**
 * Horizontal poster rail. `inset` keeps the rail inside its parent (used in the
 * details dialog); otherwise it bleeds to the viewport edge while the first
 * card shares the page gutter with the heading. Scroll buttons only appear
 * when the content overflows.
 */
export function MediaRail({ title, description, items, progressById, inset = false }: { title: string; description?: string; items: MediaSummary[]; progressById?: Record<string, number>; inset?: boolean }) {
  const railRef = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const [overflows, setOverflows] = useState(false)
  const scroll = (direction: number) => railRef.current?.scrollBy({ left: direction * railRef.current.clientWidth * 0.82, behavior: "smooth" })

  useEffect(() => {
    const node = railRef.current
    if (!node) return
    const measure = () => setOverflows(node.scrollWidth > node.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [items.length])

  if (!items.length) return null
  return (
    <section className="rail-section" aria-labelledby={headingId}>
      <div className={`${inset ? "" : "page-container "}mb-3 flex items-end justify-between gap-4`}>
        <div>
          <h2 id={headingId} className="section-title">{title}</h2>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {overflows ? (
          <div className="hidden gap-1 sm:flex">
            <Button size="icon" variant="ghost" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ChevronLeft /></Button>
            <Button size="icon" variant="ghost" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ChevronRight /></Button>
          </div>
        ) : null}
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
