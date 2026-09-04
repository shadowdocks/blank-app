import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { CircleAlert, House, RotateCcw, Search } from "lucide-react"

import { AppLink } from "@/components/app-link"
import { AppShell } from "@/components/app-shell"
import { EmptyState } from "@/components/empty-state"
import { PickPhase } from "@/components/pick-phase"
import { SearchPhase } from "@/components/search-phase"
import { SourcesPhase } from "@/components/sources-phase"
import { TitlePhase, TitleSkeleton } from "@/components/title-phase"
import { Button } from "@/components/ui/button"
import {
  ApiError,
  errorMessage,
  fetchRecommendations,
  fetchSources,
  fetchTitle,
  isAbort,
  startTorrent,
} from "@/lib/api"
import { moodName, timeName, typeName } from "@/lib/options"
import { navigate, titleMatches, titleRoute, toPath, useRoute } from "@/lib/router"
import { loadSession, saveSession } from "@/lib/storage"
import type { MediaType, Session, TimeBucket, Title, TorrentOrigin } from "@/lib/types"
import { useTorrentFeed } from "@/lib/use-torrent"

const WatchPhase = lazy(() =>
  import("@/components/watch-phase").then((module) => ({ default: module.WatchPhase }))
)

type Pending = "recommend" | "shuffle" | "sources" | "start" | null

export default function App() {
  const route = useRoute()
  const [session, setSession] = useState<Session>(loadSession)
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  /** A title hydrated from api/title, kept beside storage until it is saved. */
  const [resolved, setResolved] = useState<{ key: string; title: Title } | null>(null)
  const [titlePending, setTitlePending] = useState(false)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [titleNonce, setTitleNonce] = useState(0)

  /** One user-driven request at a time; a newer one always cancels the older. */
  const requestRef = useRef<AbortController | null>(null)
  const autoSourcesRef = useRef<string | null>(null)
  const titleRequestRef = useRef<string | null>(null)

  const routeType = route.name === "title" || route.name === "sources" ? route.type : null
  const routeId = route.name === "title" || route.name === "sources" ? route.id : null
  const routeKey = routeType && routeId ? `${routeType}:${routeId}` : null
  const fallbackType = session.type
  const storedTitles = session.titles

  const title = useMemo(() => {
    if (!routeType || !routeId) return null
    const found = storedTitles.find((item) => titleMatches(item, routeType, routeId, fallbackType))
    if (found) return found
    return resolved && resolved.key === routeKey ? resolved.title : null
  }, [fallbackType, resolved, routeId, routeKey, routeType, storedTitles])

  const torrent =
    route.name === "watch" && session.torrent && session.torrent.infoHash === route.infoHash
      ? session.torrent
      : null

  const feed = useTorrentFeed(torrent ? torrent.infoHash : null)

  useEffect(() => {
    window.parent.postMessage({ type: "GUEST_READY", stCommVersion: 1 }, "*")
  }, [])

  useEffect(() => {
    saveSession(session)
  }, [session])

  /** An unknown path resolves to the picker, so rewrite it to the real route. */
  useEffect(() => {
    if (toPath(route) !== window.location.pathname) navigate(route, { replace: true })
    setError(null)
  }, [route])

  /**
   * The URL is authoritative: a refresh or a link from another browser lands on
   * a title that storage may not have, so it is fetched by type and id.
   */
  useEffect(() => {
    if (!routeType || !routeId || title) return
    const key = `${routeType}:${routeId}`
    if (titleRequestRef.current === key) return
    titleRequestRef.current = key

    const controller = new AbortController()
    setTitlePending(true)
    setTitleError(null)

    void (async () => {
      try {
        const found = await fetchTitle(routeType, routeId, controller.signal)
        setResolved({ key, title: found })
        setSession((current) => ({
          ...current,
          titles: [found],
          sources: [],
          sourcesFor: null,
          selectedMagnet: null,
        }))
        setTitlePending(false)
      } catch (caught) {
        if (isAbort(caught)) return
        setTitleError(errorMessage(caught))
        setTitlePending(false)
      }
    })()

    return () => {
      controller.abort()
      if (titleRequestRef.current === key) titleRequestRef.current = null
    }
  }, [routeId, routeType, title, titleNonce])

  /** Keep the persisted file index in step, so a reload resumes the same file. */
  const liveVideo = feed.status?.video ?? null
  useEffect(() => {
    if (liveVideo === null) return
    setSession((current) =>
      current.torrent && current.torrent.video !== liveVideo
        ? { ...current, torrent: { ...current.torrent, video: liveVideo } }
        : current
    )
  }, [liveVideo])

  const beginRequest = useCallback((kind: Exclude<Pending, null>) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setPending(kind)
    setError(null)
    return controller
  }, [])

  const endRequest = useCallback((controller: AbortController) => {
    if (requestRef.current !== controller) return
    requestRef.current = null
    setPending(null)
  }, [])

  const findTitle = useCallback(
    async (kind: "recommend" | "shuffle" = "recommend") => {
      const controller = beginRequest(kind)
      try {
        const results = await fetchRecommendations(
          { mood: session.mood, type: session.type, time: session.time },
          controller.signal
        )
        // Without an id a title has no shareable route, so it cannot be opened.
        const openable = results.filter((item) => titleRoute(item, session.type) !== null)
        const first = openable[0]
        const target = first ? titleRoute(first, session.type) : null
        if (!target) {
          setError("Nothing matched that combination. Try another mood or length.")
          return
        }
        autoSourcesRef.current = null
        setSession((current) => ({
          ...current,
          titles: openable,
          sources: [],
          sourcesFor: null,
          selectedMagnet: null,
        }))
        navigate(target)
      } catch (caught) {
        if (!isAbort(caught)) setError(errorMessage(caught))
      } finally {
        endRequest(controller)
      }
    },
    [beginRequest, endRequest, session.mood, session.time, session.type]
  )

  const findSources = useCallback(
    async (target: Title) => {
      const controller = beginRequest("sources")
      autoSourcesRef.current = target.title
      setSession((current) => ({
        ...current,
        sources: [],
        sourcesFor: target.title,
        selectedMagnet: null,
      }))
      try {
        const results = await fetchSources(target.title, controller.signal)
        setSession((current) => ({
          ...current,
          sources: results,
          sourcesFor: target.title,
          selectedMagnet: results[0]?.magnet ?? null,
        }))
      } catch (caught) {
        if (isAbort(caught)) return
        // The server answers 404 when the search simply found nothing.
        if (caught instanceof ApiError && caught.status === 404) return
        setError(errorMessage(caught))
      } finally {
        endRequest(controller)
      }
    },
    [beginRequest, endRequest]
  )

  const startStream = useCallback(
    async (magnet: string, origin: TorrentOrigin | null) => {
      const controller = beginRequest("start")
      try {
        const status = await startTorrent(magnet, controller.signal)
        setSession((current) => ({
          ...current,
          torrent: {
            infoHash: status.infoHash,
            video: status.video,
            name: status.name,
            magnet,
            origin,
          },
        }))
        navigate({ name: "watch", infoHash: status.infoHash })
      } catch (caught) {
        if (!isAbort(caught)) setError(errorMessage(caught))
      } finally {
        endRequest(controller)
      }
    },
    [beginRequest, endRequest]
  )

  /** Landing on the source list without results (a restore, say) searches once. */
  useEffect(() => {
    if (route.name !== "sources" || !title) return
    if (autoSourcesRef.current === title.title) return
    if (session.sourcesFor === title.title && session.sources.length) return
    void findSources(title)
  }, [findSources, route.name, session.sources.length, session.sourcesFor, title])

  const openTitle = useCallback(
    (item: Title) => {
      const target = titleRoute(item, fallbackType)
      if (!target) return
      const key = `${target.type}:${target.id}`
      titleRequestRef.current = key
      setResolved({ key, title: item })
      setTitleError(null)
      autoSourcesRef.current = null
      setSession((current) => ({
        ...current,
        titles: [item],
        sources: [],
        sourcesFor: null,
        selectedMagnet: null,
      }))
      navigate(target)
    },
    [fallbackType]
  )

  const shuffle = useCallback(() => {
    if (!routeType || !routeId) return
    const index = storedTitles.findIndex((item) =>
      titleMatches(item, routeType, routeId, fallbackType)
    )
    const next = index >= 0 ? storedTitles[index + 1] : undefined
    const target = next ? titleRoute(next, fallbackType) : null
    if (!target) {
      void findTitle("shuffle")
      return
    }
    autoSourcesRef.current = null
    setError(null)
    navigate(target)
  }, [fallbackType, findTitle, routeId, routeType, storedTitles])

  const retryTitle = useCallback(() => {
    titleRequestRef.current = null
    setTitleError(null)
    setTitleNonce((value) => value + 1)
  }, [])

  const footnote = useMemo(() => {
    if (route.name === "search") return "Search by name."
    if (route.name === "pick") return "No account, no queue."
    return `${moodName(session.mood)} · ${typeName(session.type)} · ${timeName(session.time)}`
  }, [route.name, session.mood, session.time, session.type])

  const homeButton = (
    <Button asChild variant="ghost">
      <AppLink route={{ name: "pick" }}>
        <House data-icon="inline-start" aria-hidden="true" />
        Home
      </AppLink>
    </Button>
  )

  const searchButton = (
    <Button asChild variant="secondary">
      <AppLink route={{ name: "search" }}>
        <Search data-icon="inline-start" aria-hidden="true" />
        Search titles
      </AppLink>
    </Button>
  )

  let content: ReactNode

  if (route.name === "search") {
    content = <SearchPhase query={query} onQueryChange={setQuery} onSelect={openTitle} />
  } else if (route.name === "watch") {
    if (!torrent) {
      content = (
        <EmptyState
          icon={CircleAlert}
          title="That stream is not available in this browser"
          description="Streams stay with the device that started them. Search for the title to start a fresh one."
        >
          {searchButton}
          {homeButton}
        </EmptyState>
      )
    } else {
      const origin = torrent.origin
      const restart = () => {
        void startStream(torrent.magnet, origin)
        feed.refresh()
      }
      content = feed.missing ? (
        <EmptyState
          icon={CircleAlert}
          title="That stream is no longer running"
          description="The server has forgotten this torrent. Start it again from the magnet saved in this browser, or pick another source."
        >
          <Button onClick={restart} disabled={pending === "start"}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            {pending === "start" ? "Starting" : "Start it again"}
          </Button>
          {origin ? (
            <Button asChild variant="secondary">
              <AppLink route={{ name: "sources", type: origin.type, id: origin.id }}>
                Change source
              </AppLink>
            </Button>
          ) : null}
          {homeButton}
        </EmptyState>
      ) : (
        <Suspense
          fallback={
            <div className="flex aspect-video items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
              Loading player…
            </div>
          }
        >
          <WatchPhase
            torrent={torrent}
            status={feed.status}
            error={error ?? feed.error}
            onRetry={restart}
            onChangeSource={
              origin
                ? () => navigate({ name: "sources", type: origin.type, id: origin.id })
                : undefined
            }
            onBackToTitle={
              origin ? () => navigate({ name: "title", type: origin.type, id: origin.id }) : undefined
            }
            onHome={() => navigate({ name: "pick" })}
          />
        </Suspense>
      )
    }
  } else if (route.name === "title" || route.name === "sources") {
    const target = route
    if (!title) {
      content = titlePending ? (
        <TitleSkeleton />
      ) : (
        <EmptyState
          icon={CircleAlert}
          title="That title could not be loaded"
          description={titleError ?? "The catalogue has no entry for this link."}
        >
          <Button onClick={retryTitle}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Try again
          </Button>
          {searchButton}
          {homeButton}
        </EmptyState>
      )
    } else if (target.name === "title") {
      content = (
        <TitlePhase
          title={title}
          type={target.type}
          pending={pending === "sources"}
          shuffling={pending === "shuffle"}
          error={error}
          onFindSources={() => navigate({ name: "sources", type: target.type, id: target.id })}
          onShuffle={shuffle}
          onBack={() => navigate({ name: "pick" })}
        />
      )
    } else {
      content = (
        <SourcesPhase
          titleName={title.title}
          sources={session.sources}
          selectedMagnet={session.selectedMagnet}
          pending={pending === "sources"}
          starting={pending === "start"}
          error={error}
          onSelect={(magnet) => setSession((current) => ({ ...current, selectedMagnet: magnet }))}
          onStart={(magnet) => void startStream(magnet, { type: target.type, id: target.id })}
          onRetry={() => void findSources(title)}
          onBack={() => navigate({ name: "title", type: target.type, id: target.id })}
        />
      )
    }
  } else {
    content = (
      <PickPhase
        mood={session.mood}
        type={session.type}
        time={session.time}
        pending={pending === "recommend"}
        error={error}
        onMoodChange={(mood) => setSession((current) => ({ ...current, mood }))}
        onTypeChange={(type: MediaType) => setSession((current) => ({ ...current, type }))}
        onTimeChange={(time: TimeBucket) => setSession((current) => ({ ...current, time }))}
        onSubmit={() => void findTitle()}
      />
    )
  }

  return (
    <AppShell route={route} footnote={footnote}>
      {content}
    </AppShell>
  )
}
