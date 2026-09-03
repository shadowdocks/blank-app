import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { AppShell } from "@/components/app-shell"
import { PickPhase } from "@/components/pick-phase"
import { SourcesPhase } from "@/components/sources-phase"
import { TitlePhase } from "@/components/title-phase"
import { WatchPhase } from "@/components/watch-phase"
import {
  ApiError,
  errorMessage,
  fetchRecommendations,
  fetchSources,
  isAbort,
  startTorrent,
} from "@/lib/api"
import { moodName, timeName, typeName } from "@/lib/options"
import { phaseFromHash, reachablePhase, writeHash } from "@/lib/phase"
import { loadSession, saveSession } from "@/lib/storage"
import type { MediaType, Phase, Session, TimeBucket, Title } from "@/lib/types"
import { useTorrentFeed } from "@/lib/use-torrent"

type Pending = "recommend" | "shuffle" | "sources" | "start" | null

export default function App() {
  const [session, setSession] = useState<Session>(loadSession)
  const [pending, setPending] = useState<Pending>(null)
  const [error, setError] = useState<string | null>(null)

  /** One user-driven request at a time; a newer one always cancels the older. */
  const requestRef = useRef<AbortController | null>(null)
  const autoSourcesRef = useRef<string | null>(null)

  const title = session.titles[session.titleIndex] ?? null
  const torrent = session.torrent

  const feed = useTorrentFeed(session.phase === "watch" ? (torrent?.infoHash ?? null) : null)

  useEffect(() => {
    window.parent.postMessage({ type: "GUEST_READY", stCommVersion: 1 }, "*")
  }, [])

  useEffect(() => {
    saveSession(session)
  }, [session])

  useEffect(() => {
    writeHash(session.phase)
  }, [session.phase])

  useEffect(() => {
    const onHashChange = () => {
      const requested = phaseFromHash(window.location.hash)
      if (!requested) return
      setSession((current) => {
        const next = reachablePhase(current, requested)
        return next === current.phase ? current : { ...current, phase: next }
      })
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  /** A restored torrent the server has forgotten drops back to the source list. */
  useEffect(() => {
    if (!feed.missing) return
    setSession((current) => ({ ...current, torrent: null, phase: "sources" }))
    setError("That stream is no longer running. Start it again from a source.")
  }, [feed.missing])

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
        if (!results.length) {
          setError("Nothing matched that combination. Try another mood or length.")
          return
        }
        autoSourcesRef.current = null
        setSession((current) => ({
          ...current,
          titles: results,
          titleIndex: 0,
          sources: [],
          selectedMagnet: null,
          torrent: null,
          phase: "title",
        }))
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
        selectedMagnet: null,
        phase: "sources",
      }))
      try {
        const results = await fetchSources(target.title, controller.signal)
        setSession((current) => ({
          ...current,
          sources: results,
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
    async (magnet: string) => {
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
          },
          phase: "watch",
        }))
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
    if (session.phase !== "sources" || !title || session.sources.length) return
    if (autoSourcesRef.current === title.title) return
    void findSources(title)
  }, [findSources, session.phase, session.sources.length, title])

  const goTo = useCallback((phase: Phase) => {
    requestRef.current?.abort()
    requestRef.current = null
    setPending(null)
    setError(null)
    setSession((current) => ({ ...current, phase: reachablePhase(current, phase) }))
  }, [])

  const shuffle = useCallback(() => {
    const next = session.titleIndex + 1
    if (next >= session.titles.length) {
      void findTitle("shuffle")
      return
    }
    autoSourcesRef.current = null
    setError(null)
    setSession((current) => ({
      ...current,
      titleIndex: next,
      sources: [],
      selectedMagnet: null,
    }))
  }, [findTitle, session.titleIndex, session.titles.length])

  const retryStream = useCallback(() => {
    if (!torrent) return
    void startStream(torrent.magnet)
    feed.refresh()
  }, [feed, startStream, torrent])

  const footnote = useMemo(() => {
    if (session.phase === "pick") return "No account, no queue."
    return `${moodName(session.mood)} · ${typeName(session.type)} · ${timeName(session.time)}`
  }, [session.mood, session.phase, session.time, session.type])

  return (
    <AppShell phase={session.phase} footnote={footnote}>
      {session.phase === "pick" || !title ? (
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
      ) : session.phase === "title" ? (
        <TitlePhase
          title={title}
          mood={session.mood}
          type={session.type}
          pending={pending === "sources"}
          shuffling={pending === "shuffle"}
          error={error}
          onFindSources={() => void findSources(title)}
          onShuffle={shuffle}
          onBack={() => goTo("pick")}
        />
      ) : session.phase === "sources" || !torrent ? (
        <SourcesPhase
          titleName={title.title}
          sources={session.sources}
          selectedMagnet={session.selectedMagnet}
          pending={pending === "sources"}
          starting={pending === "start"}
          error={error}
          onSelect={(magnet) =>
            setSession((current) => ({ ...current, selectedMagnet: magnet }))
          }
          onStart={() => session.selectedMagnet && void startStream(session.selectedMagnet)}
          onRetry={() => void findSources(title)}
          onBack={() => goTo("title")}
        />
      ) : (
        <WatchPhase
          torrent={torrent}
          status={feed.status}
          error={error ?? feed.error}
          onRetry={retryStream}
          onChangeSource={() => goTo("sources")}
          onBack={() => goTo("title")}
        />
      )}
    </AppShell>
  )
}
