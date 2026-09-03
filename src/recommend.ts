import { FALLBACK, MOODS, type MediaType, type TimeBucket } from "./config";

const TMDB = "https://api.themoviedb.org/3";
const IMAGE = "https://image.tmdb.org/t/p";

function shuffled<T>(values: T[]): T[] {
  return values
    .map((value) => ({ value, order: Math.random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ value }) => value);
}

export async function recommend(url: URL): Promise<Response> {
  const moodId = url.searchParams.get("mood") ?? "";
  const type = (url.searchParams.get("type") ?? "movie") as MediaType;
  const time = (url.searchParams.get("time") ?? "standard") as TimeBucket;
  const mood = MOODS[moodId];
  if (!mood || !["movie", "tv"].includes(type) || !["quick", "standard", "epic"].includes(time)) {
    return Response.json({ error: "Choose a valid mood, format, and duration." }, { status: 400 });
  }

  const fallback = () => Response.json({ results: shuffled(FALLBACK[moodId][type]), source: "curated" });
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return fallback();

  const params = new URLSearchParams({
    api_key: apiKey,
    language: "en-US",
    include_adult: "false",
    sort_by: "vote_average.desc",
    with_genres: mood[type].join("|"),
    "vote_count.gte": type === "movie" ? "400" : "200",
    "vote_average.gte": type === "movie" ? "6.3" : "6.5",
    page: String(1 + Math.floor(Math.random() * 3)),
  });
  if (mood.exclude.length) params.set("without_genres", mood.exclude.join(","));
  if (type === "movie" && time === "quick") params.set("with_runtime.lte", "95");
  if (type === "movie" && time === "standard") {
    params.set("with_runtime.gte", "80");
    params.set("with_runtime.lte", "150");
  }
  if (type === "movie" && time === "epic") params.set("with_runtime.gte", "135");

  try {
    const response = await fetch(`${TMDB}/discover/${type}?${params}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fallback();
    const data = await response.json() as any;
    const candidates = shuffled((data.results ?? []).filter((item: any) => item.overview)).slice(0, 12);
    const results = candidates.map((item: any) => {
      const date = type === "movie" ? item.release_date : item.first_air_date;
      return {
        id: item.id,
        mediaType: type,
        title: type === "movie" ? item.title : item.name,
        year: date?.slice(0, 4) || null,
        overview: item.overview,
        rating: item.vote_average || null,
        runtime: null,
        genres: [],
        posterUrl: item.poster_path ? `${IMAGE}/w500${item.poster_path}` : null,
        backdropUrl: item.backdrop_path ? `${IMAGE}/w1280${item.backdrop_path}` : null,
      };
    });
    return results.length ? Response.json({ results, source: "tmdb" }) : fallback();
  } catch {
    return fallback();
  }
}
