import { expect, test as base, type Page, type Route } from "@playwright/test"

const artwork = (label: string, color: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${color}"/><text x="80" y="800" fill="white" font-family="sans-serif" font-size="96">${label}</text></svg>`)}`

const matrix = summary("tt0133093", "The Matrix", "movie", 1999, 8.7, "#183b45")
const silo = summary("tt14688458", "Silo", "tv", 2023, 8.1, "#594f3d")
const arrival = summary("tt2543164", "Arrival", "movie", 2016, 7.9, "#4e5963")

function summary(id: string, title: string, mediaType: "movie" | "tv", year: number, rating: number, color: string) {
  return {
    id,
    imdbId: id,
    tmdbId: null,
    mediaType,
    title,
    originalTitle: null,
    year,
    endYear: null,
    rating,
    voteCount: 100_000,
    genres: mediaType === "tv" ? ["Drama", "Mystery"] : ["Science fiction", "Drama"],
    posterUrl: artwork(`${title} poster`, color),
    backdropUrl: artwork(title, color),
  }
}

const details = (media: typeof matrix) => ({
  ...media,
  overview: `${media.title} test synopsis.`,
  runtimeMinutes: media.mediaType === "movie" ? 136 : 50,
  releaseDate: `${media.year}-01-01`,
  certification: "PG-13",
  metacriticScore: 73,
  countries: ["United States"],
  languages: ["English"],
  cast: [],
  trailer: null,
  similar: [arrival],
  seasons: media.mediaType === "tv" ? [{ season: 1, title: "Season 1", episodeCount: 10, year: 2023 }] : [],
})

const sources = [
  {
    id: "mkv-source",
    provider: "fixture",
    name: "Silo.S01E01.1080p.AAC",
    infoHash: "1".repeat(40),
    magnet: `magnet:?xt=urn:btih:${"1".repeat(40)}`,
    fileIndex: null,
    seeders: 100,
    leechers: 1,
    sizeBytes: 1_000_000,
    quality: "1080p",
    container: "unknown",
    codec: "avc",
    hdr: null,
    audioCodec: "aac",
    score: 1000,
  },
  {
    id: "mp4-source",
    provider: "fixture",
    name: "Silo.S01E01.720p.AAC.mp4",
    infoHash: "2".repeat(40),
    magnet: `magnet:?xt=urn:btih:${"2".repeat(40)}`,
    fileIndex: 0,
    seeders: 50,
    leechers: 1,
    sizeBytes: 900_000,
    quality: "720p",
    container: "mp4",
    codec: "avc",
    hdr: null,
    audioCodec: "aac",
    score: 900,
  },
]

export interface HawkApi {
  sourceRequestUrls: string[]
  playbackSourceIds: string[]
  deletedPlaybackIds: string[]
}

export const test = base.extend<{ hawkPage: Page; hawkApi: HawkApi }>({
  hawkApi: async ({}, use) => {
    await use({ sourceRequestUrls: [], playbackSourceIds: [], deletedPlaybackIds: [] })
  },
  hawkPage: async ({ page, hawkApi }, use) => {
    await page.route("**/api/**", (route) => mockApi(route, hawkApi))
    await use(page)
  },
})

export { expect }

async function mockApi(route: Route, state: HawkApi) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname.replace(/^\/~\/\+/, "")
  const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })

  if (path === "/api/catalog/home") {
    return json({ hero: matrix, heroes: [matrix, silo], sections: [{ id: "popular", title: "Popular Movies", items: [matrix, arrival] }], generatedAt: new Date(0).toISOString() })
  }
  if (path === "/api/catalog/title/tt0133093") return json(details(matrix))
  if (path === "/api/catalog/title/tt14688458") return json(details(silo))
  if (path === "/api/catalog/episodes/tt14688458/1") {
    return json({ seriesId: silo.id, season: 1, nextCursor: null, results: [{ id: "episode-1", imdbId: "tt-episode-1", title: "Freedom Day", season: 1, episode: 1, overview: "The silo gathers.", releaseDate: "2023-05-05", runtimeMinutes: 59, rating: 8.2, voteCount: 5000, imageUrl: artwork("Freedom Day", "#4b5148") }] })
  }
  if (path === "/api/sources") {
    state.sourceRequestUrls.push(request.url())
    return json({ results: sources })
  }
  if (path === "/api/playback" && request.method() === "POST") {
    const body = request.postDataJSON() as { source?: { id?: string } }
    const sourceId = body.source?.id ?? "unknown"
    state.playbackSourceIds.push(sourceId)
    const incompatible = sourceId === "mkv-source"
    return json({
      id: incompatible ? "playback-mkv" : "playback-mp4",
      infoHash: incompatible ? "1".repeat(40) : "2".repeat(40),
      name: incompatible ? "Silo.S01E01.mkv" : "Silo.S01E01.mp4",
      container: incompatible ? "mkv" : "mp4",
      fileIndex: 0,
      streamUrl: null,
      progress: 0,
      downloadedBytes: 0,
      totalBytes: 1_000_000,
      peers: 2,
      downloadSpeed: 1000,
      ready: true,
      complete: false,
      state: "ready",
      error: null,
      subtitles: [],
    })
  }
  const playbackMatch = /^\/api\/playback\/([^/]+)$/.exec(path)
  if (playbackMatch && request.method() === "DELETE") {
    state.deletedPlaybackIds.push(playbackMatch[1]!)
    return json({ success: true })
  }
  if (/^\/api\/playback\/[^/]+\/subtitles$/.test(path)) return json([])
  if (path === "/api/auth/me") return json({ error: "Not signed in" }, 401)
  return json({ error: `No fixture for ${request.method()} ${path}` }, 404)
}
