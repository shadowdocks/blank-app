import type {
  EpisodeSummary,
  MediaDetails,
  MediaSection,
  MediaSummary,
  SeasonSummary,
} from "../../src/shared/media";
import type { CatalogEnv } from "./env";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export interface TmdbFallbackData {
  tmdbId?: number | null;
  backdropUrl?: string | null;
  overview?: string | null;
  runtimeMinutes?: number | null;
  releaseDate?: string | null;
  certification?: string | null;
  genres?: string[];
  cast?: Array<{ id: string; name: string; character: string | null; imageUrl: string | null }>;
  seasons?: SeasonSummary[];
}

export async function fetchTmdbFallback(
  imdbId: string,
  env: CatalogEnv
): Promise<TmdbFallbackData | null> {
  const apiKey = typeof env.TMDB_API_KEY === "string" ? env.TMDB_API_KEY.trim() : "";
  if (!apiKey) return null;

  try {
    const findUrl = `${TMDB_BASE_URL}/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
    const findRes = await fetch(findUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });
    if (!findRes.ok) return null;

    const findData = (await findRes.json()) as {
      movie_results?: Array<{
        id: number;
        title: string;
        overview?: string;
        release_date?: string;
        backdrop_path?: string;
        poster_path?: string;
      }>;
      tv_results?: Array<{
        id: number;
        name: string;
        overview?: string;
        first_air_date?: string;
        backdrop_path?: string;
        poster_path?: string;
      }>;
    };

    const movie = findData.movie_results?.[0];
    const tv = findData.tv_results?.[0];

    if (movie) {
      return {
        tmdbId: movie.id,
        backdropUrl: movie.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${movie.backdrop_path}` : null,
        overview: movie.overview || null,
        releaseDate: movie.release_date || null,
      };
    }

    if (tv) {
      return {
        tmdbId: tv.id,
        backdropUrl: tv.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${tv.backdrop_path}` : null,
        overview: tv.overview || null,
        releaseDate: tv.first_air_date || null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export async function fetchTmdbEpisodes(
  imdbId: string,
  season: number,
  env: CatalogEnv
): Promise<EpisodeSummary[] | null> {
  const apiKey = typeof env.TMDB_API_KEY === "string" ? env.TMDB_API_KEY.trim() : "";
  if (!apiKey) return null;

  try {
    // First resolve TMDB ID if not provided directly
    const fallback = await fetchTmdbFallback(imdbId, env);
    if (!fallback?.tmdbId) return null;

    const seasonUrl = `${TMDB_BASE_URL}/tv/${fallback.tmdbId}/season/${season}?api_key=${encodeURIComponent(apiKey)}`;
    const seasonRes = await fetch(seasonUrl, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" },
    });
    if (!seasonRes.ok) return null;

    const seasonData = (await seasonRes.json()) as {
      episodes?: Array<{
        id: number;
        name?: string;
        episode_number: number;
        overview?: string;
        air_date?: string;
        runtime?: number;
        vote_average?: number;
        vote_count?: number;
        still_path?: string;
      }>;
    };

    if (!seasonData.episodes || !Array.isArray(seasonData.episodes)) return null;

    return seasonData.episodes.map((ep) => ({
      id: `${imdbId}:s${season}:e${ep.episode_number}`,
      imdbId,
      title: ep.name || `Episode ${ep.episode_number}`,
      season,
      episode: ep.episode_number,
      overview: ep.overview || null,
      releaseDate: ep.air_date || null,
      runtimeMinutes: ep.runtime ?? null,
      rating: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : null,
      voteCount: ep.vote_count ?? null,
      imageUrl: ep.still_path ? `${TMDB_IMAGE_BASE}/w500${ep.still_path}` : null,
    }));
  } catch {
    return null;
  }
}

/**
 * Curated offline fallback entries for complete network/upstream outages.
 */
export const CURATED_TITLES: Record<string, MediaDetails> = {
  tt0111161: {
    id: "tt0111161",
    imdbId: "tt0111161",
    tmdbId: 278,
    mediaType: "movie",
    title: "The Shawshank Redemption",
    originalTitle: "The Shawshank Redemption",
    year: 1994,
    endYear: null,
    rating: 9.3,
    voteCount: 2800000,
    genres: ["Drama"],
    posterUrl: "https://m.media-amazon.com/images/M/MV5BMDFkYTc0MGEtZmNhMC00ZDIzLWFmNTEtODM1ZmRlYWMwMWFmXkEyXkFqcGdeQXVyMTMxODk2OTU@._V1_QL75_UX500_.jpg",
    backdropUrl: null,
    overview: "Two imprisoned men bond over a number of years, finding solace and eventual redemption through acts of common decency.",
    runtimeMinutes: 142,
    releaseDate: "1994-10-14",
    certification: "R",
    metacriticScore: 82,
    countries: ["United States"],
    languages: ["English"],
    cast: [
      { id: "nm0000209", name: "Tim Robbins", character: "Andy Dufresne", imageUrl: null },
      { id: "nm0000151", name: "Morgan Freeman", character: "Ellis Boyd 'Red' Redding", imageUrl: null },
    ],
    trailer: null,
    similar: [],
    seasons: [],
  },
  tt0468569: {
    id: "tt0468569",
    imdbId: "tt0468569",
    tmdbId: 155,
    mediaType: "movie",
    title: "The Dark Knight",
    originalTitle: "The Dark Knight",
    year: 2008,
    endYear: null,
    rating: 9.0,
    voteCount: 2900000,
    genres: ["Action", "Crime", "Drama"],
    posterUrl: "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX500_.jpg",
    backdropUrl: null,
    overview: "When the menace known as the Joker wreaks havoc and chaos on the people of Gotham, Batman must accept one of the greatest psychological and physical tests of his ability to fight injustice.",
    runtimeMinutes: 152,
    releaseDate: "2008-07-18",
    certification: "PG-13",
    metacriticScore: 84,
    countries: ["United States"],
    languages: ["English"],
    cast: [
      { id: "nm0000288", name: "Christian Bale", character: "Bruce Wayne / Batman", imageUrl: null },
      { id: "nm0005132", name: "Heath Ledger", character: "Joker", imageUrl: null },
    ],
    trailer: null,
    similar: [],
    seasons: [],
  },
  tt0903747: {
    id: "tt0903747",
    imdbId: "tt0903747",
    tmdbId: 1396,
    mediaType: "tv",
    title: "Breaking Bad",
    originalTitle: "Breaking Bad",
    year: 2008,
    endYear: 2013,
    rating: 9.5,
    voteCount: 2100000,
    genres: ["Crime", "Drama", "Thriller"],
    posterUrl: "https://m.media-amazon.com/images/M/MV5BYmQ4YWMxYjUtNjZmYi00MDQ1LWFjMjAtNjA5ZD芝ZjYjN2Q@._V1_QL75_UX500_.jpg",
    backdropUrl: null,
    overview: "A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student in order to secure his family's financial future.",
    runtimeMinutes: 49,
    releaseDate: "2008-01-20",
    certification: "TV-MA",
    metacriticScore: 87,
    countries: ["United States"],
    languages: ["English", "Spanish"],
    cast: [
      { id: "nm0186505", name: "Bryan Cranston", character: "Walter White", imageUrl: null },
      { id: "nm0666739", name: "Aaron Paul", character: "Jesse Pinkman", imageUrl: null },
    ],
    trailer: null,
    similar: [],
    seasons: [
      { season: 1, title: "Season 1", episodeCount: 7, year: 2008 },
      { season: 2, title: "Season 2", episodeCount: 13, year: 2009 },
      { season: 3, title: "Season 3", episodeCount: 13, year: 2010 },
      { season: 4, title: "Season 4", episodeCount: 13, year: 2011 },
      { season: 5, title: "Season 5", episodeCount: 16, year: 2012 },
    ],
  },
};

export const CURATED_FALLBACK_EPISODES: Record<string, EpisodeSummary[]> = {
  "tt0903747:1": [
    {
      id: "tt0959621",
      imdbId: "tt0903747",
      title: "Pilot",
      season: 1,
      episode: 1,
      overview: "Diagnosed with terminal lung cancer, chemistry teacher Walter White teams up with former student Jesse Pinkman to manufacture and sell crystal meth.",
      releaseDate: "2008-01-20",
      runtimeMinutes: 58,
      rating: 9.0,
      voteCount: 45000,
      imageUrl: null,
    },
    {
      id: "tt1054728",
      imdbId: "tt0903747",
      title: "Cat's in the Bag...",
      season: 1,
      episode: 2,
      overview: "Walt and Jesse attempt to tie up loose ends after their first drug deal turns violent.",
      releaseDate: "2008-01-27",
      runtimeMinutes: 48,
      rating: 8.6,
      voteCount: 35000,
      imageUrl: null,
    },
  ],
};

export function getCuratedFallbackSections(): MediaSection[] {
  const items = Object.values(CURATED_TITLES);
  return [
    {
      id: "featured",
      title: "Featured Titles",
      items: items.map(({ overview, cast, trailer, similar, seasons, countries, languages, metacriticScore, runtimeMinutes, releaseDate, certification, ...summary }) => summary),
    },
  ];
}
