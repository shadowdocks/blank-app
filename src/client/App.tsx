import { lazy, Suspense, useEffect } from "react"

import { AppShell } from "@/components/app-shell"
import { PageSkeleton } from "@/components/page-state"
import { useNetworkStatus, useRoute } from "@/hooks"
import { navigate, toPath } from "@/lib/router"
import { HomePage } from "@/pages/home-page"
import { LibraryPage } from "@/pages/library-page"
import { SearchPage } from "@/pages/search-page"
import { TitlePage } from "@/pages/title-page"

const WatchPage = lazy(() => import("@/pages/watch-page"))

export default function App() {
  const route = useRoute()
  const network = useNetworkStatus()

  useEffect(() => {
    window.parent.postMessage({ type: "GUEST_READY", stCommVersion: 1 }, "*")
  }, [])

  useEffect(() => {
    if (toPath(route) !== window.location.pathname) navigate(route, { replace: true })
  }, [route])
  const content = route.name === "search" ? <SearchPage />
    : route.name === "title" ? <TitlePage imdbId={route.imdbId ?? route.id} />
    : route.name === "library" ? <LibraryPage />
    : route.name === "watch" ? (
      <Suspense fallback={<PageSkeleton variant="watch" />}>
        <WatchPage route={route} />
      </Suspense>
    ) : <HomePage />

  return (
    <AppShell route={route} online={network.isOnline}>
      {content}
    </AppShell>
  )
}
