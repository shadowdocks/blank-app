import * as React from "react"
import { CircleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

export function Notice({
  children,
  action,
  className,
}: {
  children: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm",
        className
      )}
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-foreground">{children}</p>
      {action}
    </div>
  )
}
