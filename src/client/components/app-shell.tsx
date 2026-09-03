import * as React from "react"
import { Film } from "lucide-react"

import { PHASES, PHASE_LABELS } from "@/lib/phase"
import type { Phase } from "@/lib/types"
import { cn } from "@/lib/utils"

function Steps({ phase }: { phase: Phase }) {
  const current = PHASES.indexOf(phase)
  return (
    <nav aria-label="Progress" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-xs sm:gap-2">
        {PHASES.map((step, index) => {
          const active = index === current
          return (
            <li key={step} className={cn("flex items-center gap-1.5 sm:gap-2", !active && "hidden sm:flex")}>
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "transition-colors",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                  index < current && "text-muted-foreground"
                )}
              >
                {PHASE_LABELS[step]}
              </span>
              {index < PHASES.length - 1 ? (
                <span aria-hidden="true" className="hidden text-border sm:inline">
                  /
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function AppShell({
  phase,
  footnote,
  children,
}: {
  phase: Phase
  footnote: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2">
            <Film className="size-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">Hawk</span>
          </span>
          <Steps phase={phase} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex min-h-12 w-full max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground sm:px-6">
          <span>Mood first, then watch.</span>
          <span className="truncate">{footnote}</span>
        </div>
      </footer>
    </div>
  )
}
