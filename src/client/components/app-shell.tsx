import * as React from "react"
import { Film, House, Search } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import { STEPS, STEP_LABELS, stepOf, type Route, type Step } from "@/lib/router"
import { cn } from "@/lib/utils"

function Steps({ step }: { step: Step }) {
  const current = STEPS.indexOf(step)
  return (
    <nav aria-label="Progress" className="hidden min-w-0 md:block">
      <ol className="flex items-center gap-2 text-xs">
        {STEPS.map((item, index) => {
          const active = index === current
          return (
            <li key={item} className="flex items-center gap-2">
              <span
                aria-current={active ? "step" : undefined}
                className={cn(
                  "transition-colors",
                  active ? "font-medium text-foreground" : "text-muted-foreground"
                )}
              >
                {STEP_LABELS[item]}
              </span>
              {index < STEPS.length - 1 ? (
                <span aria-hidden="true" className="text-border">
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
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <AppLink
            route={{ name: "pick" }}
            aria-label="Hawk home"
            className="flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <Film className="size-4 text-primary" aria-hidden="true" />
            <span className="text-sm font-semibold tracking-tight">Hawk</span>
          </AppLink>

          <div className="flex min-w-0 items-center gap-2 sm:gap-4">
            {step ? <Steps step={step} /> : null}
            <nav aria-label="Main" className="flex items-center gap-1">
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
