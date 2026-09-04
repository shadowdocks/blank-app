import { describe, expect, it } from "bun:test";
import {
  normalizedRange,
  parseByteRange,
  selectPlayableFile,
  selectSidecarSubtitles,
} from "./selection";
import type { RqbitFile } from "./types";

describe("Deterministic file selection", () => {
  it("selects exact TV episode matching season and episode", () => {
    const files: RqbitFile[] = [
      { name: "Breaking.Bad.S01/Breaking.Bad.S01E01.720p.mkv", length: 1_200_000_000, included: true },
      { name: "Breaking.Bad.S01/Breaking.Bad.S01E02.720p.mkv", length: 1_300_000_000, included: true },
      { name: "Breaking.Bad.S01/Breaking.Bad.S01E03.720p.mkv", length: 1_250_000_000, included: true },
      { name: "Breaking.Bad.S01/sample.mkv", length: 50_000_000, included: true },
    ];

    const selectedIndex = selectPlayableFile(files, "tv", 1, 2);
    expect(selectedIndex).toBe(1);
  });

  it("handles 1x02 episode notation", () => {
    const files: RqbitFile[] = [
      { name: "The.Office.1x01.Pilot.mkv", length: 500_000_000, included: true },
      { name: "The.Office.1x02.Diversity.Day.mkv", length: 550_000_000, included: true },
    ];

    const selectedIndex = selectPlayableFile(files, "tv", 1, 2);
    expect(selectedIndex).toBe(1);
  });

  it("selects largest movie video file while skipping samples", () => {
    const files: RqbitFile[] = [
      { name: "Dune.2021.1080p/Dune.2021.1080p.mkv", length: 8_000_000_000, included: true },
      { name: "Dune.2021.1080p/Sample/sample.mkv", length: 50_000_000, included: true },
      { name: "Dune.2021.1080p/Dune.2021.1080p.nfo", length: 5_000, included: true },
      { name: "Dune.2021.1080p/Dune.2021.1080p.srt", length: 120_000, included: true },
    ];

    const selectedIndex = selectPlayableFile(files, "movie");
    expect(selectedIndex).toBe(0);
  });

  it("prefers a browser-ready movie file over a larger MKV", () => {
    const files: RqbitFile[] = [
      { name: "Movie.2024.2160p.mkv", length: 8_000_000_000, included: true },
      { name: "Movie.2024.1080p.mp4", length: 3_000_000_000, included: true },
    ];

    expect(selectPlayableFile(files, "movie")).toBe(1);
  });

  it("returns null when no video files are present", () => {
    const files: RqbitFile[] = [
      { name: "info.nfo", length: 1000, included: true },
      { name: "sub.srt", length: 50000, included: true },
    ];

    expect(selectPlayableFile(files, "movie")).toBeNull();
  });
});

describe("Byte range normalization", () => {
  it("normalizes suffix ranges (bytes=-N)", () => {
    expect(normalizedRange("bytes=-500", 1000)).toBe("bytes=500-999");
    expect(normalizedRange("bytes=-1000", 1000)).toBe("bytes=0-999");
    expect(normalizedRange("bytes=-5000", 1000)).toBe("bytes=0-999");
  });

  it("preserves standard byte ranges", () => {
    expect(normalizedRange("bytes=0-499", 1000)).toBe("bytes=0-499");
    expect(normalizedRange("bytes=500-", 1000)).toBe("bytes=500-");
  });

  it("returns null for null or empty input", () => {
    expect(normalizedRange(null, 1000)).toBeNull();
    expect(normalizedRange("", 1000)).toBeNull();
  });

  it("parses valid and invalid byte ranges", () => {
    const fileLength = 1000;

    const r1 = parseByteRange("bytes=0-499", fileLength);
    expect(r1).toEqual({ start: 0, end: 499, isValid: true });

    const r2 = parseByteRange("bytes=500-", fileLength);
    expect(r2).toEqual({ start: 500, end: 999, isValid: true });

    // Range beyond file length
    const r3 = parseByteRange("bytes=1500-2000", fileLength);
    expect(r3?.isValid).toBe(false);

    // Reversed range
    const r4 = parseByteRange("bytes=500-200", fileLength);
    expect(r4?.isValid).toBe(false);
  });
});

describe("Sidecar subtitle selection", () => {
  it("identifies VTT, SRT, and ASS sidecars with language and hearing impaired tags", () => {
    const hash = "1234567890abcdef1234567890abcdef12345678";
    const files: RqbitFile[] = [
      { name: "Movie.2024.mkv", length: 5_000_000_000, included: true },
      { name: "Movie.2024.en.srt", length: 120_000, included: true },
      { name: "Movie.2024.eng.sdh.srt", length: 130_000, included: true },
      { name: "Movie.2024.spa.vtt", length: 110_000, included: true },
      { name: "Movie.2024.dan.ass", length: 140_000, included: true },
      { name: "Movie.2024.excluded.srt", length: 100_000, included: false },
    ];

    const tracks = selectSidecarSubtitles(files, hash);
    expect(tracks.length).toBe(4);

    // en.srt
    expect(tracks[0].language).toBe("en");
    expect(tracks[0].format).toBe("vtt");
    expect(tracks[0].hearingImpaired).toBe(false);

    // eng.sdh.srt
    expect(tracks[1].language).toBe("en");
    expect(tracks[1].hearingImpaired).toBe(true);
    expect(tracks[1].label).toContain("SDH");

    // spa.vtt
    expect(tracks[2].language).toBe("es");
    expect(tracks[2].format).toBe("vtt");

    // dan.ass
    expect(tracks[3].language).toBe("da");
    expect(tracks[3].format).toBe("vtt");
  });
});
