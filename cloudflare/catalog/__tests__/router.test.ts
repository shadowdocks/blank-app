import { describe, expect, it } from "bun:test";
import { handleCatalogRequest } from "../index";
import type { CatalogEnv, ExecutionContext } from "../env";
import { prefixedPath } from "../../proxy";

const dummyCtx: ExecutionContext = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};

describe("handleCatalogRequest Router", () => {
  it("handles OPTIONS preflight with CORS headers", async () => {
    const req = new Request("https://example.com/api/catalog/home", {
      method: "OPTIONS",
    });

    const res = await handleCatalogRequest(req, {}, dummyCtx);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
  });

  it("returns 404 for unknown routes", async () => {
    const req = new Request("https://example.com/api/catalog/unknown");
    const res = await handleCatalogRequest(req, {}, dummyCtx);
    expect(res.status).toBe(404);

    const body = (await res.json()) as any;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.error).toContain("Not found");
    expect(body.requestId).toBeDefined();
    expect(res.headers.get("X-Request-Id")).toBe(body.requestId);
  });

  it("enforces rate limiting when API_RATE_LIMITER blocks request", async () => {
    const env: CatalogEnv = {
      API_RATE_LIMITER: {
        limit: async () => ({ success: false }),
      },
    };

    const req = new Request("https://example.com/api/catalog/home");
    const res = await handleCatalogRequest(req, env, dummyCtx);

    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(body.error).toContain("Rate limit exceeded");
  });

  it("validates required query parameter 'q' on search", async () => {
    const req = new Request("https://example.com/api/catalog/search");
    const res = await handleCatalogRequest(req, {}, dummyCtx);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("MISSING_QUERY");
    expect(body.error).toContain("q is required");
  });

  it("validates IMDb ID format on title endpoint", async () => {
    const req = new Request("https://example.com/api/catalog/title/nm1234567");
    const res = await handleCatalogRequest(req, {}, dummyCtx);

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("INVALID_IMDB_ID");
    expect(body.error).toContain("Invalid IMDb ID format");
  });

  it("validates season parameter on episodes endpoint", async () => {
    const req1 = new Request("https://example.com/api/catalog/title/tt0903747/episodes");
    const res1 = await handleCatalogRequest(req1, {}, dummyCtx);
    expect(res1.status).toBe(400);
    const body1 = (await res1.json()) as any;
    expect(body1.code).toBe("INVALID_SEASON");

    const req2 = new Request("https://example.com/api/catalog/title/tt0903747/episodes?season=zero");
    const res2 = await handleCatalogRequest(req2, {}, dummyCtx);
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as any;
    expect(body2.code).toBe("INVALID_SEASON");

    const req3 = new Request("https://example.com/api/catalog/title/tt0903747/episodes?season=-1");
    const res3 = await handleCatalogRequest(req3, {}, dummyCtx);
    expect(res3.status).toBe(400);
    const body3 = (await res3.json()) as any;
    expect(body3.code).toBe("INVALID_SEASON");
  });

  it("serves offline fallback for title details when upstream is unavailable", async () => {
    const req = new Request("https://example.com/api/catalog/title/tt0111161");
    const res = await handleCatalogRequest(req, {}, dummyCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe("tt0111161");
    expect(body.title).toBe("The Shawshank Redemption");
    expect(body.mediaType).toBe("movie");
    expect(body.rating).toBe(9.3);
    expect(body.cast.length).toBeGreaterThan(0);
  });

  it("serves offline fallback for episodes when upstream is unavailable", async () => {
    const req = new Request("https://example.com/api/catalog/title/tt0903747/episodes?season=1");
    const res = await handleCatalogRequest(req, {}, dummyCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.seriesId).toBe("tt0903747");
    expect(body.season).toBe(1);
    expect(body.results.length).toBe(2);
    expect(body.results[0].title).toBe("Pilot");
  });

  it("serves offline fallback for home when upstream is unavailable", async () => {
    const req = new Request("https://example.com/api/catalog/home");
    const res = await handleCatalogRequest(req, {}, dummyCtx);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.sections).toBeDefined();
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
    expect(body.generatedAt).toBeDefined();
  });

  describe("Proxy prefixedPath mount handling", () => {
    it("does not duplicate prefix when pathname is already prefixed", () => {
      expect(prefixedPath("/~/+", "/~/+/api/catalog/home")).toBe("/~/+/api/catalog/home");
      expect(prefixedPath("/~/+", "/~/+/")).toBe("/~/+/");
      expect(prefixedPath("/~/+", "/~/+")).toBe("/~/+");
      expect(prefixedPath("/app", "/app/api/title/tt0903747")).toBe("/app/api/title/tt0903747");
    });

    it("prepends prefix when pathname is not prefixed", () => {
      expect(prefixedPath("/~/+", "/api/catalog/home")).toBe("/~/+/api/catalog/home");
      expect(prefixedPath("/~/+", "/")).toBe("/~/+/");
      expect(prefixedPath("/~/+", "")).toBe("/~/+/");
    });

    it("handles root or empty prefix without altering path", () => {
      expect(prefixedPath("/", "/api/catalog/home")).toBe("/api/catalog/home");
      expect(prefixedPath("", "/api/catalog/home")).toBe("/api/catalog/home");
    });
  });

  describe("Season-scoped episodes query", () => {
    const originalFetch = globalThis.fetch;

    it("passes season filter to GraphQL to handle series with >100 episodes", async () => {
      let interceptedVariables: any = null;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("graphql")) {
          const payload = JSON.parse(String(init?.body ?? "{}"));
          interceptedVariables = payload.variables;
          return new Response(
            JSON.stringify({
              data: {
                title: {
                  id: "tt0096697",
                  titleText: { text: "The Simpsons" },
                  episodes: {
                    episodes: {
                      total: 22,
                      edges: [
                        {
                          node: {
                            id: "tt3065204",
                            titleText: { text: "Homerland" },
                            releaseDate: { year: 2013, month: 9, day: 29 },
                            ratingsSummary: { aggregateRating: 7.0, voteCount: 1500 },
                            series: {
                              episodeNumber: { seasonNumber: 25, episodeNumber: 1 },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("Not Found", { status: 404 });
      }) as any;

      try {
        const env: CatalogEnv = {
          TOKEN_BROKER: {
            idFromName: () => ({}) as any,
            get: () => ({
              getToken: async () => ({
                token: "dummy-token",
                userAgent: "dummy-ua",
                expiresAt: Date.now() + 60000,
              }),
            }),
          } as any,
        };

        const req = new Request("https://example.com/api/catalog/title/tt0096697/episodes?season=25");
        const res = await handleCatalogRequest(req, env, dummyCtx);

        expect(res.status).toBe(200);
        expect(interceptedVariables).toEqual({
          id: "tt0096697",
          first: 100,
          filter: { includeSeasons: ["25"] },
        });

        const body = (await res.json()) as any;
        expect(body.seriesId).toBe("tt0096697");
        expect(body.season).toBe(25);
        expect(body.results.length).toBe(1);
        expect(body.results[0].title).toBe("Homerland");
        expect(body.results[0].season).toBe(25);
        expect(body.results[0].episode).toBe(1);
        expect(body.results[0].imageUrl).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns hero candidates in home response with bounded failures and artwork", async () => {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        const query = payload.query || "";
        if (query.includes("AdvancedTitleSearchConstraints")) {
          // Discover query: distinguish movie vs tv by anyTitleTypeIds
          const anyTitleTypeIds = payload.variables?.constraints?.titleTypeConstraint?.anyTitleTypeIds ?? [];
          const isMovie = anyTitleTypeIds.includes("movie");
          const prefix = isMovie ? "m" : "tv";
          const count = 4;
          return new Response(
            JSON.stringify({
              data: {
                advancedTitleSearch: {
                  edges: Array.from({ length: count }, (_, i) => ({
                    node: {
                      title: {
                        id: `tt_${prefix}_${i + 1}`,
                        titleType: { id: isMovie ? "movie" : "tvSeries", text: isMovie ? "Movie" : "TV Series" },
                        titleText: { text: `${prefix.toUpperCase()} Title ${i + 1}` },
                        primaryImage: { url: `https://m.media-amazon.com/${prefix}_${i + 1}.jpg`, width: 1000, height: 1500 },
                        releaseYear: { year: 2024 },
                        ratingsSummary: { aggregateRating: 8.0, voteCount: 100 },
                      },
                    },
                  })),
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (query.includes("images(first: 12)")) {
          const id = payload.variables?.id;
          // Simulate failure for tt_m_2 to verify bounded failure tolerance
          if (id === "tt_m_2") {
            return new Response("Internal Server Error", { status: 500 });
          }
          // Simulate missing backdrop for tt_tv_2
          if (id === "tt_tv_2") {
            return new Response(
              JSON.stringify({
                data: {
                  title: {
                    id,
                    images: { edges: [] },
                  },
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } }
            );
          }
          return new Response(
            JSON.stringify({
              data: {
                title: {
                  id,
                  images: {
                    edges: [
                      {
                        node: {
                          url: `https://m.media-amazon.com/${id}_backdrop.jpg`,
                          width: 1920,
                          height: 1080,
                          type: "still_frame",
                        },
                      },
                    ],
                  },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("Not Found", { status: 404 });
      }) as any;

      try {
        const env: CatalogEnv = {
          TOKEN_BROKER: {
            idFromName: () => ({}) as any,
            get: () => ({
              getToken: async () => ({
                token: "dummy-token",
                userAgent: "dummy-ua",
                expiresAt: Date.now() + 60000,
              }),
            }),
          } as any,
        };

        const req = new Request("https://example.com/api/catalog/home");
        const res = await handleCatalogRequest(req, env, dummyCtx);

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.hero).toBeDefined();
        expect(body.hero.id).toBe("tt_m_1");
        expect(body.hero.backdropUrl).toContain("tt_m_1_backdrop.jpg");

        expect(Array.isArray(body.heroes)).toBe(true);
        expect(body.heroes.length >= 4).toBe(true);
        expect(body.heroes[0].id).toBe(body.hero.id);

        // Verify deduplication
        const heroIds = body.heroes.map((h: any) => h.id);
        const uniqueIds = new Set(heroIds);
        expect(uniqueIds.size).toBe(heroIds.length);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
