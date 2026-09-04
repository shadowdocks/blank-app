import * as React from "react"
import { Download, House, Library, Search, WifiOff } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import type { Route } from "@/lib/router"
import {
  applyUpdate,
  getInstallabilityState,
  promptInstall,
  subscribeToInstallability,
  subscribeToServiceWorkerUpdates,
  type InstallabilityState,
} from "@/offline"

export function AppShell({
  route,
  online,
  children,
}: {
  route: Route
  online: boolean
  children: React.ReactNode
}) {
  const [install, setInstall] = React.useState<InstallabilityState>(getInstallabilityState)
  const [updateReady, setUpdateReady] = React.useState(false)

  React.useEffect(() => subscribeToInstallability(setInstall), [])
  React.useEffect(() => subscribeToServiceWorkerUpdates((event) => {
    if (event.type === "waiting") setUpdateReady(true)
    if (event.type === "controlling") window.location.reload()
  }), [])

  const navItems = [
    { label: "Home", route: { name: "home" } as const, icon: House, active: route.name === "home" },
    { label: "Search", route: { name: "search" } as const, icon: Search, active: route.name === "search" },
    { label: "Library", route: { name: "library" } as const, icon: Library, active: route.name === "library" },
  ]

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="page-container flex h-16 items-center justify-between gap-3">
          <AppLink
            route={{ name: "home" }}
            aria-label="Hawk home"
            className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-1 outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <span className="brand-mark" aria-hidden="true">H</span>
            <span className="text-base font-semibold tracking-[-0.035em]">Hawk</span>
          </AppLink>

          <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => (
              <Button key={item.label} asChild variant={item.active ? "secondary" : "ghost"}>
                <AppLink route={item.route} aria-current={item.active ? "page" : undefined}>
                  <item.icon data-icon="inline-start" aria-hidden="true" />{item.label}
                </AppLink>
              </Button>
            ))}
          </nav>

          <div className="flex items-center gap-1">
            {!online ? <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex"><WifiOff className="size-4" />Offline</span> : null}
            {install.isInstallable ? (
              <Button variant="ghost" onClick={() => void promptInstall()} aria-label="Install Hawk">
                <Download data-icon="inline-start" aria-hidden="true" /><span className="hidden md:inline">Install</span>
              </Button>
            ) : null}
            {updateReady ? <Button onClick={() => void applyUpdate()}>Update</Button> : null}
          </div>
        </div>
      </header>

      {!online ? <div role="status" className="border-b border-amber-400/30 bg-amber-400/10 px-4 py-2 text-center text-xs text-amber-100">You’re offline. Completed downloads remain available.</div> : null}
      <main id="main" className="min-w-0 flex-1 pb-24 sm:pb-12">{children}</main>

      <nav aria-label="Mobile navigation" className="fixed inset-x-3 bottom-3 z-50 grid grid-cols-3 rounded-xl border border-border bg-card p-1 shadow-2xl sm:hidden">
        {navItems.map((item) => (
          <AppLink key={item.label} route={item.route} aria-current={item.active ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${item.active ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <item.icon className="size-4" aria-hidden="true" />{item.label}
          </AppLink>
        ))}
      </nav>
    </div>
  )
}
