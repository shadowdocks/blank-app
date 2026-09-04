import { useEffect, useState } from "react"

import { MediaCard, bookmarkToSummary } from "@/components/media-card"
import { CollectionEmpty, ErrorState, PageContainer, PageHeading, PageSkeleton } from "@/components/page-state"
import type { PublicUserProfile } from "@/lib/account-types"
import { ApiError, errorMessage, getPublicProfile, isAbort } from "@/lib/api"

/** Public view of someone's saved titles at /u/:username. */
export function ProfilePage({ username }: { username: string }) {
  const [state, setState] = useState<{ data: PublicUserProfile | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState({ data: null, error: null, loading: true })
    getPublicProfile(username, controller.signal)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((caught: unknown) => {
        if (isAbort(caught)) return
        const message = caught instanceof ApiError && caught.status === 404 ? "This profile is private or does not exist." : errorMessage(caught)
        setState({ data: null, error: message, loading: false })
      })
    return () => controller.abort()
  }, [username, nonce])

  if (state.loading) return <PageSkeleton />
  if (state.error || !state.data) return <ErrorState message={state.error ?? "This profile could not be loaded."} onRetry={() => setNonce((value) => value + 1)} />
  const { user, bookmarks } = state.data

  return (
    <PageContainer className="animate-fade pb-8 pt-24 sm:pt-28">
      <PageHeading title={user.username}>
        <p className="text-sm text-muted-foreground">{bookmarks.length} saved · member since {new Date(user.createdAt).toLocaleDateString()}</p>
      </PageHeading>
      <div className="mt-8">
        {bookmarks.length
          ? <div className="media-grid">{bookmarks.map((item) => <MediaCard key={item.imdbId} media={bookmarkToSummary(item)} />)}</div>
          : <CollectionEmpty title="Nothing saved yet" description={`${user.username} has not saved any titles.`} />}
      </div>
    </PageContainer>
  )
}
