import { describe, expect, it } from "bun:test";
import {
  checkBadRelease,
  parseCodec,
  parseContainer,
  parseHdr,
  parseQuality,
  rankSources,
} from "./ranking";
import { parseTorrentioStream } from "./torrentio";
import { probeTorrentio } from "./health";
import type { MediaTarget, PlaybackSource } from "./types";

describe("Torrentio parsing", () => {
  it("parses movie stream with quality, codec, hdr, seeders, and size", () => {
    const stream = {
      name: "Torrentio\n4k DV",
      title:
        "The.Shawshank.Redemption.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR\n👤 101 💾 54.33 GB ⚙️ TorrentGalaxy",
      infoHash: "45fa4233ef87c58f5f8b4817e4d50c9f5363caef",
      fileIdx: 0,
      behaviorHints: {
        bingeGroup: "torrentio|4k|BluRay REMUX|hevc|DV",
        filename: "The.Shawshank.Redemption.1994.UHD.BluRay.2160p.DTS-HD.MA.5.1.DV.HEVC.HYBRID.REMUX-FraMeSToR.mkv",
      },
    };

    const parsed = parseTorrentioStream(stream);
    expect(parsed).not.toBeNull();
    expect(parsed!.provider).toBe("torrentio");
    expect(parsed!.infoHash).toBe("45FA4233EF87C58F5F8B4817E4D50C9F5363CAEF");
    expect(parsed!.fileIndex).toBe(0);
    expect(parsed!.seeders).toBe(101);
    expect(parsed!.sizeBytes).toBe(Math.round(54.33 * 1024 * 1024 * 1024));
    expect(parsed!.quality).toBe("2160p");
    expect(parsed!.container).toBe("mkv");
    expect(parsed!.codec).toBe("HEVC");
    expect(parsed!.hdr).toBe("DV");
    expect(parsed!.magnet).toContain("magnet:?xt=urn:btih:45FA4233EF87C58F5F8B4817E4D50C9F5363CAEF");
  });

  it("parses TV series stream with multi-line title and filename in behaviorHints", () => {
    const stream = {
      name: "Torrentio\n1080p",
      title:
        "Breaking Bad. S01. 2008 1080p BluRay x264\nBreaking Bad  S01E01  Pilot.mkv\n👤 45 💾 1.45 GB ⚙️ ThePirateBay",
      infoHash: "a584351126afcf50d32be068f3c9a62550d41ecc",
      fileIdx: 2,
      behaviorHints: {
        filename: "Breaking Bad  S01E01  Pilot.mkv",
      },
    };

    const parsed = parseTorrentioStream(stream);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe("Breaking Bad  S01E01  Pilot.mkv");
    expect(parsed!.seeders).toBe(45);
    expect(parsed!.sizeBytes).toBe(Math.round(1.45 * 1024 * 1024 * 1024));
    expect(parsed!.quality).toBe("1080p");
    expect(parsed!.codec).toBe("AVC");
    expect(parsed!.fileIndex).toBe(2);
  });

  it("returns null for invalid infoHash", () => {
    const stream = {
      name: "Bad Stream",
      title: "Some title",
      infoHash: "invalid_hash_too_short",
    };
    expect(parseTorrentioStream(stream)).toBeNull();
  });
});

describe("Release details extraction", () => {
  it("parses quality correctly", () => {
    expect(parseQuality("Movie.2024.2160p.WEB-DL")).toBe("2160p");
    expect(parseQuality("Movie.2024.4K.HDR")).toBe("2160p");
    expect(parseQuality("Movie.2024.1440p.WEB")).toBe("1440p");
    expect(parseQuality("Movie.2024.1080p.BluRay")).toBe("1080p");
    expect(parseQuality("Movie.2024.720p.HDTV")).toBe("720p");
    expect(parseQuality("Movie.2024.480p.DVDRip")).toBe("480p");
    expect(parseQuality("Movie.2024.DVDRip")).toBe("unknown");
  });

  it("parses codec correctly", () => {
    expect(parseCodec("Movie.2024.AV1.HDR")).toBe("AV1");
    expect(parseCodec("Movie.2024.x265.HEVC")).toBe("HEVC");
    expect(parseCodec("Movie.2024.h.264.AVC")).toBe("AVC");
    expect(parseCodec("Movie.2024.XviD-AFG")).toBe("XviD");
  });

  it("parses browser and non-browser containers", () => {
    expect(parseContainer("Movie.2024.1080p.mp4")).toBe("mp4");
    expect(parseContainer("Movie.2024.1080p.m4v")).toBe("mp4");
    expect(parseContainer("Movie.2024.1080p.webm")).toBe("webm");
    expect(parseContainer("Movie.2024.1080p.mkv")).toBe("mkv");
    expect(parseContainer("Movie.2024.1080p")).toBe("unknown");
  });

  it("parses HDR correctly", () => {
    expect(parseHdr("Movie.2024.DV.HDR10.HEVC")).toBe("DV");
    expect(parseHdr("Movie.2024.HDR10+.HEVC")).toBe("HDR10+");
    expect(parseHdr("Movie.2024.HDR10.HEVC")).toBe("HDR10");
    expect(parseHdr("Movie.2024.HDR.HEVC")).toBe("HDR");
    expect(parseHdr("Movie.2024.SDR.x264")).toBeNull();
  });

  it("detects bad releases", () => {
    expect(checkBadRelease("Movie.2024.CAM.XviD").isBad).toBe(true);
    expect(checkBadRelease("Movie.2024.HDCAM.x264").isBad).toBe(true);
    expect(checkBadRelease("Movie.2024.TELESYNC.x264").isBad).toBe(true);
    expect(checkBadRelease("Movie.2024.1080p.SAMPLE.mkv").isBad).toBe(true);
    expect(checkBadRelease("Movie.2024.1080p.rar").isBad).toBe(true);
    expect(checkBadRelease("Movie.2024.1080p.BluRay.x264").isBad).toBe(false);
  });
});

describe("Ranking algorithm", () => {
  const movieTarget: MediaTarget = {
    title: "Dune",
    mediaType: "movie",
    imdbId: "tt1160419",
    year: 2021,
    season: null,
    episode: null,
    episodeTitle: null,
  };

  const tvTarget: MediaTarget = {
    title: "Breaking Bad",
    mediaType: "tv",
    imdbId: "tt0903747",
    year: 2008,
    season: 1,
    episode: 2,
    episodeTitle: "Cat's in the Bag...",
  };

  it("favors exact season and episode match over mismatched episodes", () => {
    const exactMatch: PlaybackSource = {
      id: "1",
      provider: "torrentio",
      name: "Breaking.Bad.S01E02.1080p.BluRay.x264",
      infoHash: "AAAA111122223333444455556666777788889999",
      magnet: "magnet:?xt=urn:btih:AAAA111122223333444455556666777788889999",
      fileIndex: 0,
      seeders: 50,
      leechers: 5,
      sizeBytes: 1.5 * 1024 * 1024 * 1024,
      quality: "1080p",
      container: "mkv",
      codec: "AVC",
      hdr: null,
      score: 0,
    };

    const wrongEpisode: PlaybackSource = {
      id: "2",
      provider: "torrentio",
      name: "Breaking.Bad.S01E05.1080p.BluRay.x264",
      infoHash: "BBBB111122223333444455556666777788889999",
      magnet: "magnet:?xt=urn:btih:BBBB111122223333444455556666777788889999",
      fileIndex: 0,
      seeders: 200,
      leechers: 10,
      sizeBytes: 1.5 * 1024 * 1024 * 1024,
      quality: "1080p",
      container: "mkv",
      codec: "AVC",
      hdr: null,
      score: 0,
    };

    const ranked = rankSources([wrongEpisode, exactMatch], tvTarget);
    expect(ranked[0].id).toBe("1");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("heavily penalizes CAM releases for movies", () => {
    const goodWeb: PlaybackSource = {
      id: "good",
      provider: "apibay",
      name: "Dune.2021.1080p.WEB-DL.x264",
      infoHash: "1111111111111111111111111111111111111111",
      magnet: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
      fileIndex: null,
      seeders: 30,
      leechers: 5,
      sizeBytes: 3 * 1024 * 1024 * 1024,
      quality: "1080p",
      container: "mp4",
      codec: "AVC",
      hdr: null,
      score: 0,
    };

    const badCam: PlaybackSource = {
      id: "bad",
      provider: "apibay",
      name: "Dune.2021.HDCAM.XviD",
      infoHash: "2222222222222222222222222222222222222222",
      magnet: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
      fileIndex: null,
      seeders: 500, // High seeders
      leechers: 50,
      sizeBytes: 1.2 * 1024 * 1024 * 1024,
      quality: "480p",
      container: "avi",
      codec: "XviD",
      hdr: null,
      score: 0,
    };

    const ranked = rankSources([badCam, goodWeb], movieTarget);
    expect(ranked[0].id).toBe("good");
    expect(ranked[1].score).toBeLessThan(0); // Cam penalty sinks it below 0
  });

  it("ranks deterministically with infoHash tie-breaker", () => {
    const sourceA: PlaybackSource = {
      id: "a",
      provider: "apibay",
      name: "Dune.2021.1080p",
      infoHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      magnet: "magnet:?",
      fileIndex: null,
      seeders: 50,
      leechers: 0,
      sizeBytes: 2 * 1024 * 1024 * 1024,
      quality: "1080p",
      container: "mp4",
      codec: "AVC",
      hdr: null,
      score: 0,
    };

    const sourceB: PlaybackSource = {
      id: "b",
      provider: "apibay",
      name: "Dune.2021.1080p",
      infoHash: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      magnet: "magnet:?",
      fileIndex: null,
      seeders: 50,
      leechers: 0,
      sizeBytes: 2 * 1024 * 1024 * 1024,
      quality: "1080p",
      container: "mp4",
      codec: "AVC",
      hdr: null,
      score: 0,
    };

    const result1 = rankSources([sourceB, sourceA], movieTarget);
    const result2 = rankSources([sourceA, sourceB], movieTarget);
    expect(result1[0].infoHash).toBe(result2[0].infoHash);
  });

  it("prefers a browser-compatible MP4 over a more seeded MKV", () => {
    const compatible: PlaybackSource = {
      id: "mp4", provider: "torrentio", name: "Dune.2021.1080p.x264.mp4",
      infoHash: "1111111111111111111111111111111111111111", magnet: "magnet:?", fileIndex: 0,
      seeders: 20, leechers: 0, sizeBytes: 2_000_000_000, quality: "1080p",
      container: "mp4", codec: "AVC", hdr: null, score: 0,
    };
    const incompatible: PlaybackSource = {
      ...compatible,
      id: "mkv", name: "Dune.2021.2160p.HEVC.mkv",
      infoHash: "2222222222222222222222222222222222222222", seeders: 2_000,
      quality: "2160p", container: "mkv", codec: "HEVC",
    };

    expect(rankSources([incompatible, compatible], movieTarget)[0].id).toBe("mp4");
  });
});

describe("Health probe response shape and errors", () => {
  it("distinguishes ok, http_error, timeout, and invalid_shape without dumping raw data", async () => {
    const originalFetch = globalThis.fetch;

    // Test 1: HTTP Error
    globalThis.fetch = async () => new Response("Server error", { status: 503 });
    const httpErr = await probeTorrentio(1000);
    expect(httpErr.status).toBe("http_error");
    expect(httpErr.statusCode).toBe(503);
    expect(httpErr.error).toBe("HTTP 503");

    // Test 2: Timeout
    globalThis.fetch = async () => {
      return new Promise((_, reject) => {
        const err = new Error("aborted");
        err.name = "AbortError";
        setTimeout(() => reject(err), 50);
      });
    };
    const timeoutErr = await probeTorrentio(30);
    expect(timeoutErr.status).toBe("timeout");
    expect(timeoutErr.statusCode).toBeNull();
    expect(timeoutErr.error).toContain("Timed out");

    // Test 3: Invalid shape (HTML page instead of JSON)
    globalThis.fetch = async () => new Response("<!DOCTYPE html><html><body>Error</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const shapeErr = await probeTorrentio(1000);
    expect(shapeErr.status).toBe("invalid_shape");
    expect(shapeErr.error).toBe("Response body is not valid JSON");
    // Ensure no HTML was dumped into error string
    expect(shapeErr.error).not.toContain("<!DOCTYPE");

    // Test 4: OK
    globalThis.fetch = async () => new Response(JSON.stringify({ streams: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const okProbe = await probeTorrentio(1000);
    expect(okProbe.status).toBe("ok");
    expect(okProbe.statusCode).toBe(200);
    expect(okProbe.error).toBeNull();

    // Restore original fetch
    globalThis.fetch = originalFetch;
  });
});
