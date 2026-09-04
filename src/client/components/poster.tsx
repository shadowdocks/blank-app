import { useEffect, useState } from "react"
import { Film } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Posters come from a third party and can 404 or be blocked. A failed load
 * falls back to the same placeholder a missing URL gets, never an empty frame.
 */
export function Poster({
  src,
  className,
}: {
  src?: string | null
  className?: string
}) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border border-border bg-secondary transition-colors",
        className
      )}
    >
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="aspect-[2/3] w-full object-cover"
        />
      ) : (
        <div className="flex aspect-[2/3] w-full items-center justify-center">
          <Film className="size-6 text-muted-foreground sm:size-8" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
