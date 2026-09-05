export type MediaType = "movie" | "tv"

export interface MediaSummary {
  id: string
  imdbId: string | null
  tmdbId: number | null
  mediaType: MediaType
  title: string
  originalTitle: string | null
  year: number | null
  endYear: number | null
  rating: number | null
  voteCount: number | null
  genres: string[]
  posterUrl: string | null
  backdropUrl: string | null
}

export interface CastMember {
  id: string
  name: string
  character: string | null
  imageUrl: string | null
}

export interface MediaVideo {
  id: string
  title: string
  type: string | null
  url: string | null
  thumbnailUrl: string | null
  durationSeconds: number | null
}

export interface MediaDetails extends MediaSummary {
  overview: string | null
  runtimeMinutes: number | null
  releaseDate: string | null
  certification: string | null
  metacriticScore: number | null
  countries: string[]
  languages: string[]
  cast: CastMember[]
  trailer: MediaVideo | null
  similar: MediaSummary[]
  seasons: SeasonSummary[]
}

export interface SeasonSummary {
  season: number
  title: string
  episodeCount: number | null
  year: number | null
}

export interface EpisodeSummary {
  id: string
  imdbId: string | null
  title: string
  season: number
  episode: number
  overview: string | null
  releaseDate: string | null
  runtimeMinutes: number | null
  rating: number | null
  voteCount: number | null
  imageUrl: string | null
}

export interface MediaSection {
  id: string
  title: string
  items: MediaSummary[]
}

export interface CatalogHome {
  hero: MediaSummary | null
  heroes?: MediaSummary[]
  sections: MediaSection[]
  generatedAt: string
}

export interface CatalogPage<T> {
  results: T[]
  nextCursor: string | null
}

export interface EpisodePage extends CatalogPage<EpisodeSummary> {
  seriesId: string
  season: number
}
