import * as React from "react"
import { House, Library, Search, Settings, UserRound } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks"
import type { Route } from "@/lib/router"
import { applyUpdate, subscribeToServiceWorkerUpdates } from "@/offline"

/**
 * Browse chrome: a quiet header, the page, and a flat bottom bar on phones.
 * The watch route renders no chrome at all; the player is the page.
 */
export function AppShell({
  route,
  online,
  children,
}: {
  route: Route
  online: boolean
  children: React.ReactNode
}) {
  const auth = useAuth()
  const [updateReady, setUpdateReady] = React.useState(false)
  const [scrolled, setScrolled] = React.useState(false)
  const watching = route.name === "watch"

  React.useEffect(() => subscribeToServiceWorkerUpdates((event) => {
    if (event.type === "waiting") setUpdateReady(true)
    if (event.type === "controlling") window.location.reload()
  }), [])
  React.useEffect(() => {
    if (watching) return
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [watching])

  if (watching) return <>{children}</>

  const navItems = [
    { label: "Home", route: { name: "home" } as const, icon: House, active: route.name === "home" },
    { label: "Search", route: { name: "search" } as const, icon: Search, active: route.name === "search" },
    { label: "Library", route: { name: "library" } as const, icon: Library, active: route.name === "library" },
    { label: "Settings", route: { name: "settings" } as const, icon: Settings, active: route.name === "settings" },
  ]
  const accountActive = route.name === "login" || route.name === "profile"
  const linkClass = (active: boolean) => `inline-flex h-11 items-center rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/60 ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="chrome-header fixed inset-x-0 top-0 z-40" data-scrolled={scrolled ? "true" : "false"}>
        <div className="page-container flex h-16 items-center gap-2">
          <AppLink
            route={{ name: "home" }}
            aria-label="Hawk home"
            className="inline-flex h-11 shrink-0 items-center rounded-lg px-1 text-base font-semibold tracking-[-0.035em] outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            Hawk
          </AppLink>

          <nav aria-label="Main" className="ml-4 hidden items-center gap-0.5 sm:flex">
            {navItems.map((item) => (
              <AppLink key={item.label} route={item.route} aria-current={item.active ? "page" : undefined} className={linkClass(item.active)}>
                {item.label}
              </AppLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            {!online ? <span className="hidden text-xs text-muted-foreground md:inline" role="status">Offline</span> : null}
            {updateReady ? <Button size="sm" variant="outline" onClick={() => void applyUpdate()}>Update</Button> : null}
            {auth.user ? (
              <AppLink route={{ name: "settings" }} aria-current={route.name === "settings" ? "page" : undefined} aria-label={`Account: ${auth.user.username}`} className={linkClass(false)}>
                <UserRound className="size-4 sm:hidden" aria-hidden="true" />
                <span className="hidden sm:inline">{auth.user.username}</span>
              </AppLink>
            ) : auth.status === "loading" || !auth.isInitialized ? null : (
              <AppLink route={{ name: "login" }} aria-current={accountActive ? "page" : undefined} className={linkClass(accountActive)}>Login</AppLink>
            )}
          </div>
        </div>
      </header>

      {!online ? <div role="status" className="fixed inset-x-0 top-16 z-40 bg-background px-4 py-2 text-center text-xs text-muted-foreground">You’re offline. Completed downloads remain available.</div> : null}
      <main id="main" className="min-w-0 flex-1 pb-24 sm:pb-12">{children}</main>

      <nav aria-label="Mobile navigation" className="mobile-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-4 sm:hidden">
        {navItems.map((item) => (
          <AppLink key={item.label} route={item.route} aria-current={item.active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${item.active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <item.icon className="size-5" aria-hidden="true" />{item.label}
          </AppLink>
        ))}
      </nav>
    </div>
  )
}
