import { useCallback, useEffect, useRef, useState } from "react"

import {
  errorMessage,
  fetchCatalogEpisodes,
  fetchCatalogHome,
  fetchCatalogTitle,
  isAbort,
  searchCatalog,
} from "@/lib/api"
import type {
  CatalogHome,
  CatalogPage,
  EpisodePage,
  MediaDetails,
  MediaSummary,
  MediaType,
} from "../../shared/media"

export interface CatalogRequestState<T> {
  data: T | null
  loading: boolean
  error: string | null
  retry: () => void
  abort: () => void
}

export function useCatalogRequest<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[] = []
): CatalogRequestState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    if (controllerRef.current) {
      controllerRef.current.abort()
      controllerRef.current = null
    }
  }, [])

  const retry = useCallback(() => {
    setNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError(null)

    let active = true

    fetcher(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
        setLoading(false)
        setError(null)
      })
      .catch((err) => {
        if (!active || isAbort(err)) return
        setData(null)
        setLoading(false)
        setError(errorMessage(err))
      })

    return () => {
      active = false
      controller.abort()
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps])

  return { data, loading, error, retry, abort }
}

export function useCatalogHome(): CatalogRequestState<CatalogHome> {
  return useCatalogRequest((signal) => fetchCatalogHome(signal), [])
}

export function useCatalogSearch(
  query: string,
  options?: { type?: MediaType }
): CatalogRequestState<CatalogPage<MediaSummary>> {
  const trimmed = query.trim()
  return useCatalogRequest(
    (signal) => {
      if (!trimmed) {
        return Promise.resolve({ results: [], nextCursor: null })
      }
      return searchCatalog({ query: trimmed, type: options?.type }, signal)
    },
    [trimmed, options?.type]
  )
}

export function useCatalogTitle(imdbId: string | null): CatalogRequestState<MediaDetails | null> {
  return useCatalogRequest(
    (signal) => {
      if (!imdbId) return Promise.resolve(null)
      return fetchCatalogTitle(imdbId, signal)
    },
    [imdbId]
  )
}

export function useCatalogEpisodes(
  imdbId: string | null,
  season: number | null
): CatalogRequestState<EpisodePage | null> {
  return useCatalogRequest(
    (signal) => {
      if (!imdbId || season === null) return Promise.resolve(null)
      return fetchCatalogEpisodes(imdbId, season, signal)
    },
    [imdbId, season]
  )
}
