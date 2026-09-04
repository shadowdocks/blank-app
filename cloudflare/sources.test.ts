import { describe, expect, it } from "bun:test";
import { handleEdgeSources } from "./sources";

const context = {
  waitUntil() {},
} as unknown as ExecutionContext;

describe("edge source lookup", () => {
  it("returns normalized and ranked Torrentio sources", async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return Response.json({
      streams: [{
        name: "Torrentio\n1080p",
        title: "Example.Movie.2026.1080p.x264.mp4\n👤 42\n💾 2.0 GB",
        infoHash: "1111111111111111111111111111111111111111",
        fileIdx: 3,
        behaviorHints: { filename: "Example.Movie.2026.1080p.x264.mp4" },
      }],
      });
    };

    try {
      const response = await handleEdgeSources(
        new Request("https://hawk.example/api/sources?title=Example&imdbId=tt1234567&mediaType=movie&year=2026"),
        context,
      );

      expect(calls).toBe(1);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("x-hawk-source-egress")).toBe("edge");
      const body = await response?.json() as { results: Array<{ provider: string; container: string; fileIndex: number }> };
      expect(body.results[0].provider).toBe("torrentio");
      expect(body.results[0].container).toBe("mp4");
      expect(body.results[0].fileIndex).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to the origin when Torrentio rejects edge egress", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status: 403 });

    try {
      const response = await handleEdgeSources(
        new Request("https://hawk.example/api/sources?title=Example&imdbId=tt1234567&mediaType=movie"),
        context,
      );

      expect(response).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
