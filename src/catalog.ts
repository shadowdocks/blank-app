import { FALLBACK, type MediaType } from "./config";

const IMDB_SUGGEST = "https://v2.sg.media-imdb.com/suggestion/x";
const TMDB = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p";

export type CatalogTitle = {
  id: string | number;
  mediaType: MediaType;
  title: string;
  year: string | null;
  overview: string | null;
  rating: number | null;
  runtime: number | null;
  genres: string[];
  posterUrl: string | null;
  backdropUrl: string | null;
};

type ImdbSuggestion = {
  id?: string;
  l?: string;
  y?: number;
  q?: string;
  qid?: string;
  i?: { imageUrl?: string };
};

const suggestionCache = new Map<string, Promise<ImdbSuggestion[]>>();

function imdbImage(url: string | undefined): string | null {
  if (!url) return null;
  return url.replace(/\._V1_[^.]*\.(jpg|jpeg|png)$/i, "._V1_QL75_UX500.$1");
}

function mediaTypeOf(item: ImdbSuggestion): MediaType {
  const kind = `${item.qid ?? ""} ${item.q ?? ""}`.toLowerCase();
  return kind.includes("tv") || kind.includes("series") ? "tv" : "movie";
}

function fallbackFor(title: string, year?: string | null) {
  const target = title.toLowerCase();
  return Object.entries(FALLBACK).flatMap(([, byType]) =>
    (["movie", "tv"] as const).flatMap((mediaType) =>
      byType[mediaType]
        .filter((item) => item.title.toLowerCase() === target && (!year || item.year === year))
        .map((item) => ({ ...item, mediaType })),
    ),
  )[0];
}

async function suggestions(query: string): Promise<ImdbSuggestion[]> {
  const key = query.trim().toLowerCase();
  if (!key) return [];
  let request = suggestionCache.get(key);
  if (!request) {
    request = fetch(`${IMDB_SUGGEST}/${encodeURIComponent(key)}.json`, {
      headers: { "User-Agent": "hawk/2.0" },
      signal: AbortSignal.timeout(8_000),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`IMDb ${response.status}`);
        const data = await response.json() as { d?: ImdbSuggestion[] };
        return Array.isArray(data.d) ? data.d : [];
      })
      .catch(() => {
        suggestionCache.delete(key);
        return [];
      });
    suggestionCache.set(key, request);
    if (suggestionCache.size > 100) suggestionCache.delete(suggestionCache.keys().next().value!);
  }
  return request;
}

function fromImdb(item: ImdbSuggestion): CatalogTitle | null {
  if (!item.id?.startsWith("tt") || !item.l) return null;
  const mediaType = mediaTypeOf(item);
  const year = item.y ? String(item.y) : null;
  const fallback = fallbackFor(item.l, year);
  const posterUrl = imdbImage(item.i?.imageUrl);
  return {
    id: item.id,
    mediaType,
    title: item.l,
    year,
    overview: fallback?.overview ?? null,
    rating: fallback?.rating ?? null,
    runtime: fallback?.runtime ?? null,
    genres: fallback?.genres ?? [],
    posterUrl,
    backdropUrl: posterUrl,
  };
}

export async function enrichWithImdb<T extends { title: string; year?: string | null }>(
  title: T,
  mediaType: MediaType,
): Promise<T & Partial<CatalogTitle>> {
  const matches = await suggestions(title.title);
  const exact = matches.find((item) =>
    item.l?.toLowerCase() === title.title.toLowerCase()
      && (!title.year || String(item.y ?? "") === title.year)
      && mediaTypeOf(item) === mediaType,
  );
  const mapped = exact && fromImdb(exact);
  return mapped ? { ...title, ...mapped } : { ...title, mediaType };
}

export async function searchCatalog(query: string): Promise<CatalogTitle[]> {
  const matches = await suggestions(query);
  const results: CatalogTitle[] = [];
  const seen = new Set<string>();
  for (const item of matches) {
    const mapped = fromImdb(item);
    if (!mapped || seen.has(String(mapped.id))) continue;
    seen.add(String(mapped.id));
    results.push(mapped);
    if (results.length === 20) break;
  }
  return results;
}

export async function titleById(type: MediaType, id: string): Promise<CatalogTitle | null> {
  if (/^tt\d+$/i.test(id)) {
    const matches = await suggestions(id);
    const match = matches.find((item) => item.id?.toLowerCase() === id.toLowerCase());
    const mapped = match && fromImdb(match);
    return mapped ? { ...mapped, mediaType: type } : null;
  }

  if (!/^\d+$/.test(id) || !process.env.TMDB_API_KEY) return null;
  try {
    const response = await fetch(
      `${TMDB}/${type}/${id}?api_key=${process.env.TMDB_API_KEY}&language=en-US`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return null;
    const item = await response.json() as any;
    const date = type === "movie" ? item.release_date : item.first_air_date;
    return {
      id: Number(id),
      mediaType: type,
      title: type === "movie" ? item.title : item.name,
      year: date?.slice(0, 4) || null,
      overview: item.overview || null,
      rating: item.vote_average || null,
      runtime: type === "movie" ? item.runtime || null : item.episode_run_time?.[0] || null,
      genres: (item.genres ?? []).map((genre: any) => genre.name).filter(Boolean),
      posterUrl: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : null,
      backdropUrl: item.backdrop_path ? `${TMDB_IMAGE}/w1280${item.backdrop_path}` : null,
    };
  } catch {
    return null;
  }
}

export async function search(url: URL): Promise<Response> {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return Response.json({ results: [] });
  return Response.json({ results: await searchCatalog(query), source: "imdb" });
}

export async function titleDetails(url: URL): Promise<Response> {
  const type = url.searchParams.get("type") === "tv" ? "tv" : "movie";
  const id = url.searchParams.get("id")?.trim() ?? "";
  const result = await titleById(type, id);
  return result
    ? Response.json({ result })
    : Response.json({ error: "Title not found." }, { status: 404 });
}
