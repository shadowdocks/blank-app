import { describe, expect, it } from "bun:test";
import {
  determineMediaType,
  formatReleaseDate,
  imdbImage,
  normalizeEpisodeThumbnail,
  normalizeEpisodes,
  normalizeMediaSummary,
  normalizeSuggestionItem,
  normalizeTitleDetail,
  type TitleNode,
} from "../normalize";

describe("Catalog Normalization", () => {
  it("determines media type accurately", () => {
    expect(determineMediaType("movie")).toBe("movie");
    expect(determineMediaType("tvMovie")).toBe("movie");
    expect(determineMediaType("feature")).toBe("movie");
    expect(determineMediaType("tvSeries")).toBe("tv");
    expect(determineMediaType("tvMiniSeries")).toBe("tv");
    expect(determineMediaType("tv_series")).toBe("tv");
    expect(determineMediaType("series")).toBe("tv");
    expect(determineMediaType(undefined)).toBe("movie");
  });

  it("formats IMDb images properly", () => {
    expect(imdbImage(null)).toBeNull();
    expect(
      imdbImage(
        "https://m.media-amazon.com/images/M/MV5BMDFkYTc0MGEtZmNhMC00ZDIzLWFmNTEtODM1ZmRlYWMwMWFmXkEyXkFqcGdeQXVyMTMxODk2OTU@._V1_.jpg",
        500
      )
    ).toBe(
      "https://m.media-amazon.com/images/M/MV5BMDFkYTc0MGEtZmNhMC00ZDIzLWFmNTEtODM1ZmRlYWMwMWFmXkEyXkFqcGdeQXVyMTMxODk2OTU@._V1_QL75_UX500_.jpg"
    );
    expect(
      imdbImage(
        "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX300_.jpg",
        500
      )
    ).toBe(
      "https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_QL75_UX500_.jpg"
    );
  });

  it("formats release date correctly", () => {
    expect(formatReleaseDate(null)).toBeNull();
    expect(formatReleaseDate({ year: 1994, month: 10, day: 14 })).toBe("1994-10-14");
    expect(formatReleaseDate({ year: 1994, month: 5, day: null })).toBe("1994-05");
    expect(formatReleaseDate({ year: 1994 })).toBe("1994");
  });

  it("normalizes search suggestions into MediaSummary", () => {
    const item = {
      id: "tt0111161",
      l: "The Shawshank Redemption",
      y: 1994,
      qid: "movie",
      s: "Tim Robbins, Morgan Freeman",
      i: {
        imageUrl: "https://m.media-amazon.com/images/M/MV5B._V1_.jpg",
        width: 1000,
        height: 1500,
      },
    };

    const normalized = normalizeSuggestionItem(item);
    expect(normalized).not.toBeNull();
    expect(normalized?.id).toBe("tt0111161");
    expect(normalized?.imdbId).toBe("tt0111161");
    expect(normalized?.mediaType).toBe("movie");
    expect(normalized?.title).toBe("The Shawshank Redemption");
    expect(normalized?.year).toBe(1994);
    expect(normalized?.posterUrl).toContain("_V1_QL75_UX500_.jpg");
  });

  it("rejects non-title search suggestions", () => {
    expect(normalizeSuggestionItem({ id: "nm0000209", l: "Tim Robbins" })).toBeNull();
    expect(normalizeSuggestionItem({ id: "" })).toBeNull();
  });

  it("normalizes full TitleNode into MediaDetails with all fields", () => {
    const titleNode: TitleNode = {
      id: "tt0468569",
      titleText: { text: "The Dark Knight" },
      originalTitleText: { text: "The Dark Knight" },
      releaseYear: { year: 2008, endYear: null },
      releaseDate: { year: 2008, month: 7, day: 18 },
      runtime: { seconds: 9120 },
      titleType: { id: "movie", text: "Movie" },
      ratingsSummary: { aggregateRating: 9.0, voteCount: 2900000 },
      metacritic: { metascore: { score: 84 } },
      certificate: { rating: "PG-13", ratingReason: "Intense sequences of violence" },
      genres: {
        genres: [
          { id: "Action", text: "Action" },
          { id: "Crime", text: "Crime" },
        ],
      },
      plot: { plotText: { plainText: "When the menace known as the Joker wreaks havoc..." } },
      countriesOfOrigin: { countries: [{ id: "US", text: "United States" }] },
      spokenLanguages: { spokenLanguages: [{ id: "en", text: "English" }] },
      primaryImage: { url: "https://m.media-amazon.com/images/M/MV5B._V1_.jpg", width: 1000, height: 1500 },
      images: {
        edges: [
          { node: { url: "https://m.media-amazon.com/images/M/backdrop-small._V1_.jpg", width: 1280, height: 720 } },
          { node: { url: "https://m.media-amazon.com/images/M/backdrop-large._V1_.jpg", width: 1920, height: 1080 } },
        ],
      },
      latestTrailer: {
        id: "vi123456",
        name: { value: "Official Trailer" },
        runtime: { value: 150 },
      },
      credits: {
        edges: [
          {
            node: {
              category: { id: "actor", text: "Actor" },
              characters: [{ name: "Bruce Wayne" }],
              name: {
                id: "nm0000288",
                nameText: { text: "Christian Bale" },
                primaryImage: { url: "https://m.media-amazon.com/images/M/actor._V1_.jpg" },
              },
            },
          },
          {
            node: {
              category: { id: "actor", text: "Actor" },
              name: {
                id: "nm0005132",
                nameText: { text: "Heath Ledger" },
              },
            },
          },
        ],
      },
      moreLikeThisTitles: {
        edges: [
          {
            node: {
              id: "tt1345836",
              titleText: { text: "The Dark Knight Rises" },
              titleType: { id: "movie" },
              releaseYear: { year: 2012 },
              ratingsSummary: { aggregateRating: 8.4, voteCount: 1700000 },
              primaryImage: { url: "https://m.media-amazon.com/images/M/sim._V1_.jpg" },
            },
          },
        ],
      },
      episodes: null,
    };

    const details = normalizeTitleDetail(titleNode);
    expect(details.id).toBe("tt0468569");
    expect(details.imdbId).toBe("tt0468569");
    expect(details.mediaType).toBe("movie");
    expect(details.title).toBe("The Dark Knight");
    expect(details.year).toBe(2008);
    expect(details.runtimeMinutes).toBe(152);
    expect(details.rating).toBe(9.0);
    expect(details.voteCount).toBe(2900000);
    expect(details.metacriticScore).toBe(84);
    expect(details.certification).toBe("PG-13");
    expect(details.genres).toEqual(["Action", "Crime"]);
    expect(details.countries).toEqual(["United States"]);
    expect(details.languages).toEqual(["English"]);
    expect(details.backdropUrl).toBe("https://m.media-amazon.com/images/M/backdrop-large._V1_QL75_UX1280_.jpg");
    expect(details.cast.length).toBe(2);
    expect(details.cast[0].name).toBe("Christian Bale");
    expect(details.cast[0].character).toBe("Bruce Wayne");
    expect(details.cast[1].name).toBe("Heath Ledger");
    expect(details.cast[1].character).toBeNull();
    expect(details.trailer).not.toBeNull();
    expect(details.trailer?.url).toBe("https://www.imdb.com/video/vi123456");
    expect(details.trailer?.durationSeconds).toBe(150);
    expect(details.similar.length).toBe(1);
    expect(details.similar[0].id).toBe("tt1345836");
    expect(details.seasons).toEqual([]);
  });

  it("normalizes seasons and episodes correctly", () => {
    const seriesNode: TitleNode = {
      id: "tt0903747",
      titleText: { text: "Breaking Bad" },
      titleType: { id: "tvSeries", text: "TV Series" },
      releaseYear: { year: 2008, endYear: 2013 },
      episodes: {
        displayableSeasons: {
          edges: [
            { node: { season: "2", displayableProperty: { value: { plainText: "Season 2" } } } },
            { node: { season: "1", displayableProperty: { value: { plainText: "Season 1" } } } },
          ],
        },
        episodes: {
          edges: [
            {
              node: {
                id: "tt0959621",
                titleText: { text: "Pilot" },
                releaseDate: { year: 2008, month: 1, day: 20 },
                ratingsSummary: { aggregateRating: 9.0, voteCount: 45000 },
                series: {
                  episodeNumber: { seasonNumber: 1, episodeNumber: 1 },
                },
              },
            },
            {
              node: {
                id: "tt1054728",
                titleText: { text: "Cat's in the Bag..." },
                releaseDate: { year: 2008, month: 1, day: 27 },
                ratingsSummary: { aggregateRating: 8.6, voteCount: 35000 },
                series: {
                  episodeNumber: { seasonNumber: 1, episodeNumber: 2 },
                },
              },
            },
            {
              node: {
                id: "tt1234567",
                titleText: { text: "Seven Thirty-Seven" },
                releaseDate: { year: 2009, month: 3, day: 8 },
                ratingsSummary: { aggregateRating: 8.7, voteCount: 30000 },
                series: {
                  episodeNumber: { seasonNumber: 2, episodeNumber: 1 },
                },
              },
            },
          ],
        },
      },
    };

    const details = normalizeTitleDetail(seriesNode);
    expect(details.mediaType).toBe("tv");
    expect(details.seasons.length).toBe(2);
    expect(details.seasons[0].season).toBe(1);
    expect(details.seasons[1].season).toBe(2);

    const s1Episodes = normalizeEpisodes(seriesNode, 1);
    expect(s1Episodes.seriesId).toBe("tt0903747");
    expect(s1Episodes.season).toBe(1);
    expect(s1Episodes.results.length).toBe(2);
    expect(s1Episodes.results[0].title).toBe("Pilot");
    expect(s1Episodes.results[0].episode).toBe(1);
    expect(s1Episodes.results[1].title).toBe("Cat's in the Bag...");
    expect(s1Episodes.results[1].episode).toBe(2);

    const s2Episodes = normalizeEpisodes(seriesNode, 2);
    expect(s2Episodes.results.length).toBe(1);
    expect(s2Episodes.results[0].title).toBe("Seven Thirty-Seven");

    const s3Episodes = normalizeEpisodes(seriesNode, 3);
    expect(s3Episodes.results.length).toBe(0);
  });

  it("normalizeEpisodeThumbnail selects still_frame over publicity or poster", () => {
    const epNode = {
      primaryImage: {
        url: "https://m.media-amazon.com/images/M/poster.jpg",
        width: 1000,
        height: 1500,
        type: "poster",
      },
      images: {
        edges: [
          {
            node: {
              url: "https://m.media-amazon.com/images/M/event.jpg",
              width: 1920,
              height: 1080,
              type: "event",
            },
          },
          {
            node: {
              url: "https://m.media-amazon.com/images/M/publicity.jpg",
              width: 1920,
              height: 1080,
              type: "publicity",
            },
          },
          {
            node: {
              url: "https://m.media-amazon.com/images/M/MV5Bstill@._V1_.jpg",
              width: 1920,
              height: 1080,
              type: "still_frame",
            },
          },
        ],
      },
    };

    const thumbnail = normalizeEpisodeThumbnail(epNode);
    expect(thumbnail).toContain("https://m.media-amazon.com/images/M/MV5Bstill");
    expect(thumbnail).toContain("UX500");
  });

  it("normalizeEpisodeThumbnail rejects publicity or event photos as primaryImage", () => {
    const epNodeWithPublicity = {
      primaryImage: {
        url: "https://m.media-amazon.com/images/M/event_primary.jpg",
        width: 1920,
        height: 1080,
        type: "event",
      },
      images: {
        edges: [
          {
            node: {
              url: "https://m.media-amazon.com/images/M/event_primary.jpg",
              width: 1920,
              height: 1080,
              type: "event",
            },
          },
        ],
      },
    };

    expect(normalizeEpisodeThumbnail(epNodeWithPublicity)).toBeNull();
  });

  it("normalizeEpisodeThumbnail falls back to landscape untyped image or null", () => {
    const epNodeUntyped = {
      images: {
        edges: [
          {
            node: {
              url: "https://m.media-amazon.com/images/M/untyped.jpg",
              width: 1280,
              height: 720,
              type: null,
            },
          },
        ],
      },
    };

    const thumbnail = normalizeEpisodeThumbnail(epNodeUntyped);
    expect(thumbnail).toContain("https://m.media-amazon.com/images/M/untyped.jpg");

    const epNodeEmpty = { images: { edges: [] } };
    expect(normalizeEpisodeThumbnail(epNodeEmpty)).toBeNull();
  });
});
