import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** The shared card for "nothing here" and "this cannot be restored" screens. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card px-4 py-8 text-center",
        className
      )}
    >
      {Icon ? <Icon className="mx-auto mb-3 size-5 text-muted-foreground" aria-hidden="true" /> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {children ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
