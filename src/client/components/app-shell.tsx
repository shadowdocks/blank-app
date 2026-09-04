import * as React from "react"
import { Film, Search } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import type { Route } from "@/lib/router"

export function AppShell({
  route,
  footnote,
  children,
}: {
  route: Route
  footnote: string
  children: React.ReactNode
}) {
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

          <nav aria-label="Main">
            <Button asChild size="sm" variant={route.name === "search" ? "secondary" : "ghost"}>
              <AppLink route={{ name: "search" }} aria-current={route.name === "search" ? "page" : undefined}>
                <Search data-icon="inline-start" aria-hidden="true" />
                Search
              </AppLink>
            </Button>
          </nav>
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
