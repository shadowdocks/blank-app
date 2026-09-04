import { useCallback, useEffect, useState } from "react"

import { errorMessage, isAbort, searchTitles } from "@/lib/api"
import { titleIdOf } from "@/lib/router"
import type { Title } from "@/lib/types"

const DEBOUNCE_MS = 300

/** Below this a query matches almost everything, so it is not worth a request. */
export const MIN_QUERY = 2

export interface SearchFeed {
  results: Title[]
  pending: boolean
  error: string | null
  retry: () => void
}

/**
 * Debounced title search. Every keystroke replaces the pending timer and aborts
 * the in-flight request, so a slow response can never overwrite a newer one.
 */
export function useSearch(query: string): SearchFeed {
  const [results, setResults] = useState<Title[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const trimmed = query.trim()

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) {
      setResults([])
      setPending(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    setPending(true)
    setError(null)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await searchTitles(trimmed, controller.signal)
          // A hit without an id has no route, so it could never be opened.
          setResults(found.filter((item) => titleIdOf(item) !== null))
          setPending(false)
        } catch (caught) {
          if (isAbort(caught)) return
          setResults([])
          setError(errorMessage(caught))
          setPending(false)
        }
      })()
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [nonce, trimmed])

  const retry = useCallback(() => setNonce((value) => value + 1), [])
  return { results, pending, error, retry }
}
