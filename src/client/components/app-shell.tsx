import * as React from "react"
import { Check, ChevronRight, Film, House, Search } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import { STEPS, STEP_LABELS, stepOf, type Route, type Step } from "@/lib/router"
import { cn } from "@/lib/utils"

function Steps({ step }: { step: Step }) {
  const current = STEPS.indexOf(step)
  return (
    <nav aria-label="Viewing progress" className="border-t border-border/70 bg-card/40">
      <ol className="mx-auto hidden h-10 w-full max-w-5xl items-center px-6 text-xs md:flex">
        {STEPS.map((item, index) => {
          const active = index === current
          const complete = index < current
          return (
            <li key={item} className="flex min-w-0 items-center">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 transition-colors",
                  active ? "font-medium text-primary" : complete ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex size-4 items-center justify-center rounded-full border text-[9px] tabular-nums",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : complete
                        ? "border-foreground/40 bg-foreground/10"
                        : "border-border"
                  )}
                  aria-hidden="true"
                >
                  {complete ? <Check className="size-2.5" /> : index + 1}
                </span>
                {STEP_LABELS[item]}
              </span>
              {index < STEPS.length - 1 ? (
                <ChevronRight aria-hidden="true" className="mx-3 size-3.5 text-border" />
              ) : null}
            </li>
          )
        })}
      </ol>
      <div className="mx-auto flex h-9 w-full max-w-5xl items-center px-4 text-xs text-muted-foreground md:hidden">
        <span className="font-medium text-primary">{STEP_LABELS[step]}</span>
        <span className="ml-2">Step {current + 1} of {STEPS.length}</span>
      </div>
    </nav>
  )
}

function NavButton({
  route,
  icon: Icon,
  label,
  active,
}: {
  route: Route
  icon: typeof House
  label: string
  active: boolean
}) {
  return (
    <Button asChild size="sm" variant={active ? "secondary" : "ghost"}>
      <AppLink route={route} aria-current={active ? "page" : undefined}>
        <Icon data-icon="inline-start" aria-hidden="true" />
        {label}
      </AppLink>
    </Button>
  )
}

export function AppShell({
  route,
  footnote,
  children,
}: {
  route: Route
  footnote: string
  children: React.ReactNode
}) {
  const step = stepOf(route)

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <AppLink
            route={{ name: "pick" }}
            aria-label="Hawk home"
            className="flex shrink-0 items-center gap-2.5 rounded-lg px-1 py-1 outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="flex size-8 items-center justify-center rounded-md border border-primary/25 bg-primary/10">
              <Film className="size-4 text-primary" aria-hidden="true" />
            </span>
            <span className="text-base font-semibold tracking-tight">Hawk</span>
          </AppLink>

          <div className="flex min-w-0 items-center">
            <nav aria-label="Main" className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
              <NavButton
                route={{ name: "pick" }}
                icon={House}
                label="Home"
                active={route.name === "pick"}
              />
              <NavButton
                route={{ name: "search" }}
                icon={Search}
                label="Search"
                active={route.name === "search"}
              />
            </nav>
          </div>
        </div>
        {step ? <Steps step={step} /> : null}
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
