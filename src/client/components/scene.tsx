import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The shared cinema backdrop: artwork under a directional shade so text on the
 * lower-left stays readable. Home, the details dialog and the watch page all
 * use it so every route feels like the same room.
 *
 * `stage` adds an ambient blurred copy of the artwork behind a sharp inset
 * frame from 64rem up; below that the frame is full-bleed.
 */
export function Scene({
  image,
  soft = false,
  tone = "default",
  priority = false,
  stage = false,
  frameClassName,
  className,
  children,
  ...props
}: React.ComponentProps<"section"> & {
  image: string | null
  /** Blur and dim the artwork; used when only a poster is available. */
  soft?: boolean
  tone?: "default" | "dim" | "veil"
  priority?: boolean
  stage?: boolean
  frameClassName?: string
}) {
  const art = image ? (
    <img
      src={image}
      alt=""
      className="scene-art"
      data-soft={soft ? "true" : undefined}
      fetchPriority={priority ? "high" : "auto"}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
    />
  ) : null
  const shade = <div className="scene-shade" data-tone={tone === "default" ? undefined : tone} aria-hidden="true" />

  if (!stage) {
    return (
      <section className={cn("scene", className)} {...props}>
        {art}
        {shade}
        {children}
      </section>
    )
  }

  return (
    <section className={cn("scene", className)} {...props}>
      {image ? <img src={image} alt="" className="scene-art" data-ambient="true" loading="lazy" decoding="async" aria-hidden="true" /> : null}
      <div className={cn("stage-frame", frameClassName)}>
        {art}
        {shade}
        {children}
      </div>
    </section>
  )
}
