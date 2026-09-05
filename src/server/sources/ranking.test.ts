import { describe, expect, it } from "bun:test";
import {
  checkBadRelease,
  evaluateAudioCodecCompatibility,
  parseAudioCodec,
  parseCodec,
  parseContainer,
  parseHdr,
  parseQuality,
  parseSeasonEpisode,
  rankSources,
} from "./ranking";
import { buildApiBayQueries, buildApiBayQuery } from "./apibay";
import { parseTorrentioStream } from "./torrentio";
import { probeTorrentio } from "./health";
import type { ClientCapabilities, MediaTarget, PlaybackSource } from "./types";

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

describe("Audio codec parsing", () => {
  it("parses AAC variants accurately", () => {
    expect(parseAudioCodec("Show.S01E01.1080p.AAC.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.AAC2.0.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.AAC5.1.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.AAC 2.0.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.AAC.2.0.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.HE-AAC.x264")).toBe("aac");
    expect(parseAudioCodec("Show.S01E01.1080p.AAC-LC.x264")).toBe("aac");
  });

  it("parses AC3 variants accurately", () => {
    expect(parseAudioCodec("Show.S01E01.1080p.AC3.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.AC-3.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.Ac3.5.1.H264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.AC35.1.H264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.Dolby.Digital.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD5.1.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD 5.1.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD2.0.x264")).toBe("ac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD.x264")).toBe("ac3");
  });

  it("parses EAC3 variants accurately", () => {
    expect(parseAudioCodec("Show.S01E01.1080p.EAC3.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.E-AC-3.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.EC-3.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.EC3.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD+.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD+5.1.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DD+ 5.1.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DDPLUS.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DDP.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DDP5.1.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.DDP5 1.x264")).toBe("eac3");
    expect(parseAudioCodec("Show.S01E01.1080p.Dolby.Digital.Plus.x264")).toBe("eac3");
  });

  it("parses Opus and MP3 accurately", () => {
    expect(parseAudioCodec("Show.S01E01.1080p.Opus.x264")).toBe("opus");
    expect(parseAudioCodec("Show.S01E01.1080p.OPUS2.0.x264")).toBe("opus");
    expect(parseAudioCodec("Show.S01E01.1080p.MP3.x264")).toBe("mp3");
    expect(parseAudioCodec("Show.S01E01.1080p.mp3.avi")).toBe("mp3");
  });

  it("does not misclassify video codecs or unrelated words as audio codecs", () => {
    expect(parseAudioCodec("Movie.2024.1080p.AVC.x264")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.HEVC.x265")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.AV1")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.XviD-AFG")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.MPEG2")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.x264-DDR")).toBe("unknown");
    expect(parseAudioCodec("Movie.Sudden.Impact.1080p.x264")).toBe("unknown");
    expect(parseAudioCodec("Movie.Teddy.Bear.1080p.x264")).toBe("unknown");
    expect(parseAudioCodec("Movie.2024.1080p.H264.mp4")).toBe("unknown");
  });
});

describe("Capability-aware audio ranking", () => {
  const target: MediaTarget = {
    title: "Lanterns",
    mediaType: "tv",
    imdbId: "tt26545992",
    year: 2026,
    season: 1,
    episode: 1,
    episodeTitle: "Pilot",
  };

  const aacSource: PlaybackSource = {
    id: "src-aac",
    provider: "torrentio",
    name: "Lanterns.S01E01.1080p.WEB.H264.AAC2.0.mp4",
    infoHash: "1111111111111111111111111111111111111111",
    magnet: "magnet:?xt=urn:btih:1111111111111111111111111111111111111111",
    fileIndex: null,
    seeders: 15,
    leechers: 2,
    sizeBytes: 1.2 * 1e9,
    quality: "1080p",
    container: "mp4",
    codec: "AVC",
    hdr: null,
    audioCodec: "aac",
    score: 0,
  };

  const ac3Source: PlaybackSource = {
    id: "src-ac3",
    provider: "torrentio",
    name: "Lanterns.S01E01.1080p.WEB.H264.AC3.5.1.mp4",
    infoHash: "2222222222222222222222222222222222222222",
    magnet: "magnet:?xt=urn:btih:2222222222222222222222222222222222222222",
    fileIndex: null,
    seeders: 500, // Many more seeders
    leechers: 50,
    sizeBytes: 1.2 * 1e9,
    quality: "1080p",
    container: "mp4",
    codec: "AVC",
    hdr: null,
    audioCodec: "ac3",
    score: 0,
  };

  const unknownAudioSource: PlaybackSource = {
    id: "src-unknown",
    provider: "torrentio",
    name: "Lanterns.S01E01.1080p.WEB.H264.mp4",
    infoHash: "3333333333333333333333333333333333333333",
    magnet: "magnet:?xt=urn:btih:3333333333333333333333333333333333333333",
    fileIndex: null,
    seeders: 15,
    leechers: 2,
    sizeBytes: 1.2 * 1e9,
    quality: "1080p",
    container: "mp4",
    codec: "AVC",
    hdr: null,
    audioCodec: "unknown",
    score: 0,
  };

  it("prioritizes supported AAC over explicitly unsupported AC3 despite higher seed count", () => {
    const capabilities: ClientCapabilities = {
      supportedAudioCodecs: ["aac", "opus", "mp3"],
      unsupportedAudioCodecs: ["ac3", "eac3"],
    };

    const ranked = rankSources([ac3Source, aacSource], target, capabilities);
    expect(ranked[0].id).toBe("src-aac");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].audioCodec).toBe("aac");
    expect(ranked[1].audioCodec).toBe("ac3");
  });

  it("retains unknown audio at intermediate priority between supported and unsupported", () => {
    const capabilities: ClientCapabilities = {
      supportedAudioCodecs: ["aac"],
      unsupportedAudioCodecs: ["ac3"],
    };

    const ranked = rankSources([ac3Source, unknownAudioSource, aacSource], target, capabilities);
    expect(ranked[0].id).toBe("src-aac");
    expect(ranked[1].id).toBe("src-unknown");
    expect(ranked[2].id).toBe("src-ac3");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("does not allow a CAM release with supported audio to beat a healthy release with unsupported audio", () => {
    const camWithAac: PlaybackSource = {
      id: "cam-aac",
      provider: "apibay",
      name: "Lanterns.S01E01.CAM.AAC.mp4",
      infoHash: "4444444444444444444444444444444444444444",
      magnet: "magnet:?",
      fileIndex: null,
      seeders: 200,
      leechers: 10,
      sizeBytes: 0.8 * 1e9,
      quality: "480p",
      container: "mp4",
      codec: "AVC",
      hdr: null,
      audioCodec: "aac",
      score: 0,
    };

    const capabilities: ClientCapabilities = {
      supportedAudioCodecs: ["aac"],
      unsupportedAudioCodecs: ["ac3"],
    };

    const ranked = rankSources([camWithAac, ac3Source], target, capabilities);
    expect(ranked[0].id).toBe("src-ac3");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("remains backward compatible when no capabilities are provided", () => {
    const rankedNoCaps = rankSources([aacSource, ac3Source], target);
    // Without audio capability input, higher seeders win on identical specs
    expect(rankedNoCaps[0].id).toBe("src-ac3");
    expect(rankedNoCaps[0].audioCodec).toBe("ac3");
    expect(rankedNoCaps[1].audioCodec).toBe("aac");
  });
});

describe("Season and episode parsing variants", () => {
  it("extracts season and episode from various naming conventions", () => {
    expect(parseSeasonEpisode("Show.S01E02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.s01e02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.S01.E02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show S01 E02 1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.1x02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.01x02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show Season 1 Episode 2")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.S01.EP02.1080p")).toEqual({ season: 1, episode: 2 });
    expect(parseSeasonEpisode("Show.S01.1080p")).toEqual({ season: 1, episode: undefined });
    expect(parseSeasonEpisode("Show.Episode.2.1080p")).toEqual({ season: undefined, episode: 2 });
  });
});

describe("APiBay query construction", () => {
  it("strips parenthetical year from TV show title to avoid over-constraining", () => {
    const target: MediaTarget = {
      title: "Lanterns (2026)",
      mediaType: "tv",
      imdbId: "tt26545992",
      year: 2026,
      season: 1,
      episode: 1,
      episodeTitle: "Pilot",
    };
    expect(buildApiBayQuery(target)).toBe("Lanterns S01E01");
    expect(buildApiBayQueries(target)).toEqual(["Lanterns S01E01", "Lanterns 1x01"]);
  });

  it("handles season-only TV target without defaulting to episode 1", () => {
    const target: MediaTarget = {
      title: "Lanterns",
      mediaType: "tv",
      imdbId: "tt26545992",
      year: 2026,
      season: 1,
      episode: null,
      episodeTitle: null,
    };
    expect(buildApiBayQuery(target)).toBe("Lanterns S01");
    expect(buildApiBayQueries(target)).toEqual(["Lanterns S01"]);
  });

  it("constructs movie query with year", () => {
    const target: MediaTarget = {
      title: "Dune",
      mediaType: "movie",
      imdbId: "tt1160419",
      year: 2021,
      season: null,
      episode: null,
      episodeTitle: null,
    };
    expect(buildApiBayQuery(target)).toBe("Dune 2021");
    expect(buildApiBayQueries(target)).toEqual(["Dune 2021"]);
  });
});
