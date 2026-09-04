import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { imdbGraphql, searchSuggestions } from "../transport";
import type { CatalogEnv } from "../env";
import { GRAPHQL_URL } from "../token-broker";

describe("IMDb GraphQL & Search Transport", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("searchSuggestions returns empty array for empty or whitespace query", async () => {
    const res1 = await searchSuggestions("");
    const res2 = await searchSuggestions("   ");
    expect(res1).toEqual([]);
    expect(res2).toEqual([]);
  });

  it("searchSuggestions queries v3 suggestion endpoint and parses results", async () => {
    let requestedUrl = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      requestedUrl = url.toString();
      return new Response(
        JSON.stringify({
          d: [
            {
              id: "tt0111161",
              l: "The Shawshank Redemption",
              y: 1994,
              qid: "movie",
            },
          ],
        }),
        { status: 200 }
      );
    }) as any;

    const results = await searchSuggestions("shawshank");
    expect(requestedUrl).toContain("v3.sg.media-imdb.com/suggestion/s/shawshank.json");
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("tt0111161");
  });

  it("retries once after HTTP 403 using broker with rejectedToken", async () => {
    let tokenCalls = 0;
    const tokens = [
      { token: "initial-waf-token", userAgent: "ua-1", expiresAt: Date.now() + 10000 },
      { token: "refreshed-waf-token", userAgent: "ua-2", expiresAt: Date.now() + 10000 },
    ];

    const mockBroker = {
      getToken: async (rejectedToken: string | null, _requestId: string) => {
        tokenCalls++;
        if (tokenCalls === 1) {
          expect(rejectedToken).toBeNull();
          return tokens[0];
        }
        expect(rejectedToken).toBe("initial-waf-token");
        return tokens[1];
      },
    };

    const env: CatalogEnv = {
      TOKEN_BROKER: {
        idFromName: () => ({ toString: () => "id", equals: () => true }),
        get: () => mockBroker as any,
      },
    };

    let fetchCalls = 0;
    const receivedCookies: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls++;
      const headers = new Headers(init?.headers);
      receivedCookies.push(headers.get("Cookie") || "");

      if (fetchCalls === 1) {
        return new Response("Forbidden", { status: 403 });
      }

      return new Response(
        JSON.stringify({
          data: {
            title: { id: "tt0468569", titleText: { text: "The Dark Knight" } },
          },
        }),
        { status: 200 }
      );
    }) as any;

    const data = await imdbGraphql<{ title: { id: string; titleText: { text: string } } }>(
      env,
      "req-retry-test",
      "query { title }",
      {}
    );

    expect(data.title.id).toBe("tt0468569");
    expect(tokenCalls).toBe(2);
    expect(fetchCalls).toBe(2);
    expect(receivedCookies[0]).toContain("aws-waf-token=initial-waf-token");
    expect(receivedCookies[1]).toContain("aws-waf-token=refreshed-waf-token");
  });

  it("throws UpstreamError if request fails after 403 retry", async () => {
    const mockBroker = {
      getToken: async () => ({
        token: "token",
        userAgent: "ua",
        expiresAt: Date.now() + 10000,
      }),
    };

    const env: CatalogEnv = {
      TOKEN_BROKER: {
        idFromName: () => ({ toString: () => "id", equals: () => true }),
        get: () => mockBroker as any,
      },
    };

    globalThis.fetch = (async () => {
      return new Response("Forbidden", { status: 403 });
    }) as any;

    expect(
      imdbGraphql(env, "req-fail-test", "query { title }", {})
    ).rejects.toThrow("IMDb GraphQL query failed");
  });
});
