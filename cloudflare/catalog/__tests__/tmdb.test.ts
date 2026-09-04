import { describe, expect, it, afterEach } from "bun:test";
import {
  fetchTmdbEpisodes,
  fetchTmdbFallback,
  getCuratedFallbackSections,
  CURATED_TITLES,
  CURATED_FALLBACK_EPISODES,
} from "../tmdb";

describe("TMDB Fallback Adapter & Curated Constants", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns null if TMDB_API_KEY is not set", async () => {
    const res1 = await fetchTmdbFallback("tt0468569", {});
    const res2 = await fetchTmdbEpisodes("tt0903747", 1, {});
    expect(res1).toBeNull();
    expect(res2).toBeNull();
  });

  it("resolves movie details from TMDB find endpoint", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      expect(urlStr).toContain("/find/tt0468569");
      expect(urlStr).toContain("api_key=mock-key");

      return new Response(
        JSON.stringify({
          movie_results: [
            {
              id: 155,
              title: "The Dark Knight",
              overview: "Batman raises the stakes in his war on crime.",
              release_date: "2008-07-16",
              backdrop_path: "/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg",
            },
          ],
        }),
        { status: 200 }
      );
    }) as any;

    const fallback = await fetchTmdbFallback("tt0468569", { TMDB_API_KEY: "mock-key" });
    expect(fallback).not.toBeNull();
    expect(fallback?.tmdbId).toBe(155);
    expect(fallback?.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/nMKdUUepR0i5zn0y1T4CsSB5chy.jpg");
    expect(fallback?.overview).toBe("Batman raises the stakes in his war on crime.");
    expect(fallback?.releaseDate).toBe("2008-07-16");
  });

  it("resolves tv episodes from TMDB tv season endpoint", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes("/find/tt0903747")) {
        return new Response(
          JSON.stringify({
            tv_results: [
              {
                id: 1396,
                name: "Breaking Bad",
                backdrop_path: "/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg",
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (urlStr.includes("/tv/1396/season/1")) {
        return new Response(
          JSON.stringify({
            episodes: [
              {
                id: 62085,
                name: "Pilot",
                episode_number: 1,
                overview: "Walter White is a chemistry teacher...",
                air_date: "2008-01-20",
                runtime: 58,
                vote_average: 8.8,
                vote_count: 5000,
                still_path: "/ydlY3iPxe6og7SZvN10kudMGw2k.jpg",
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response("Not found", { status: 404 });
    }) as any;

    const episodes = await fetchTmdbEpisodes("tt0903747", 1, { TMDB_API_KEY: "mock-key" });
    expect(episodes).not.toBeNull();
    expect(episodes?.length).toBe(1);
    expect(episodes?.[0].id).toBe("tt0903747:s1:e1");
    expect(episodes?.[0].title).toBe("Pilot");
    expect(episodes?.[0].episode).toBe(1);
    expect(episodes?.[0].runtimeMinutes).toBe(58);
    expect(episodes?.[0].imageUrl).toBe("https://image.tmdb.org/t/p/w500/ydlY3iPxe6og7SZvN10kudMGw2k.jpg");
  });

  it("provides curated titles and fallback sections without external calls", () => {
    const sections = getCuratedFallbackSections();
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].items.length).toBeGreaterThan(0);

    const darkKnight = CURATED_TITLES["tt0468569"];
    expect(darkKnight).toBeDefined();
    expect(darkKnight.title).toBe("The Dark Knight");
    expect(darkKnight.rating).toBe(9.0);

    const bbEpisodes = CURATED_FALLBACK_EPISODES["tt0903747:1"];
    expect(bbEpisodes).toBeDefined();
    expect(bbEpisodes.length).toBeGreaterThan(0);
  });
});
