import { useCallback, useEffect, useState } from "react"

import { ApiError, errorMessage, fetchTorrent, isAbort } from "@/lib/api"
import type { TorrentStatus } from "@/lib/types"

const POLL_MS = 1500

export interface TorrentFeed {
  status: TorrentStatus | null
  error: string | null
  /** The server no longer knows this hash; the caller should fall back to sources. */
  missing: boolean
  refresh: () => void
}

/**
 * Polls one torrent every 1.5s. Each tick aborts the previous in-flight request,
 * so a slow response can never overwrite a newer one.
 */
export function useTorrentFeed(infoHash: string | null): TorrentFeed {
  const [status, setStatus] = useState<TorrentStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    setStatus(null)
    setError(null)
    setMissing(false)
  }, [infoHash, nonce])

  useEffect(() => {
    if (!infoHash) return

    let active = true
    let timer = 0
    let controller: AbortController | null = null

    const tick = async () => {
      controller?.abort()
      controller = new AbortController()
      try {
        const next = await fetchTorrent(infoHash, controller.signal)
        if (!active) return
        setStatus(next)
        setError(null)
        if (next.done) return
      } catch (caught) {
        if (!active || isAbort(caught)) return
        if (caught instanceof ApiError && caught.status === 404) {
          setMissing(true)
          return
        }
        setError(errorMessage(caught))
      }
      if (active) timer = window.setTimeout(() => void tick(), POLL_MS)
    }

    void tick()
    return () => {
      active = false
      controller?.abort()
      window.clearTimeout(timer)
    }
  }, [infoHash, nonce])

  const refresh = useCallback(() => setNonce((value) => value + 1), [])
  return { status, error, missing, refresh }
}
