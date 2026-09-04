import { lazy, Suspense, useEffect, useRef } from "react"

import { AppShell } from "@/components/app-shell"
import { MediaDetailsDialog } from "@/components/media-details-dialog"
import { PageSkeleton } from "@/components/page-state"
import { useNetworkStatus, useRoute } from "@/hooks"
import { navigate, toPath, type Route } from "@/lib/router"
import { HomePage } from "@/pages/home-page"
import { LibraryPage } from "@/pages/library-page"
import { LoginPage } from "@/pages/login-page"
import { ProfilePage } from "@/pages/profile-page"
import { SearchPage } from "@/pages/search-page"
import { SettingsPage } from "@/pages/settings-page"

const WatchPage = lazy(() => import("@/pages/watch-page"))

type BrowseRoute = Extract<Route, { name: "home" | "search" | "library" | "settings" | "login" | "profile" }>

const isBrowse = (route: Route): route is BrowseRoute => route.name !== "title" && route.name !== "watch"

export default function App() {
  const route = useRoute()
  const network = useNetworkStatus()
  /** The browse view that stays mounted underneath the title dialog. */
  const browseRef = useRef<BrowseRoute>({ name: "home" })
  /** How many title entries sit above the browse view in history (0 = deep link or from watch). */
  const depthRef = useRef(-1)

  useEffect(() => {
    window.parent.postMessage({ type: "GUEST_READY", stCommVersion: 1 }, "*")
  }, [])

  useEffect(() => {
    if (toPath(route) !== window.location.pathname) navigate(route, { replace: true })
  }, [route])

  useEffect(() => {
    if (route.name === "title") { depthRef.current += 1; return }
    depthRef.current = isBrowse(route) ? 0 : -1
    if (isBrowse(route)) browseRef.current = route
  }, [route])

  useEffect(() => {
    // The watch route owns the viewport; nothing behind it may scroll.
    document.documentElement.style.overflow = route.name === "watch" ? "hidden" : ""
    return () => { document.documentElement.style.overflow = "" }
  }, [route.name])

  const closeDetails = () => {
    // A single title pushed on top of a browse view unwinds cleanly; anything
    // deeper (title chains, deep links, arriving from watch) replaces instead.
    if (depthRef.current === 1) history.back()
    else navigate(browseRef.current, { replace: true })
  }

  const chromeRoute = route.name === "title" ? browseRef.current : route
  const content = route.name === "watch" ? (
    <Suspense fallback={<PageSkeleton variant="watch" />}>
      <WatchPage route={route} />
    </Suspense>
  ) : chromeRoute.name === "search" ? <SearchPage />
    : chromeRoute.name === "library" ? <LibraryPage />
    : chromeRoute.name === "settings" ? <SettingsPage />
    : chromeRoute.name === "login" ? <LoginPage />
    : chromeRoute.name === "profile" ? <ProfilePage key={chromeRoute.username} username={chromeRoute.username} />
    : <HomePage />

  return (
    <AppShell route={chromeRoute} online={network.isOnline}>
      {content}
      {route.name === "title" ? <MediaDetailsDialog key={route.imdbId ?? route.id} imdbId={route.imdbId ?? route.id} onClose={closeDetails} /> : null}
    </AppShell>
  )
}
