import { describe, expect, it } from "bun:test";
import { convertAssToVtt, convertSrtToVtt, ensureWebVtt } from "./converter";
import { validateSubtitleUrl } from "./proxy";

describe("SRT to WebVTT conversion", () => {
  it("converts SRT format to valid WebVTT", () => {
    const srt = `1
00:01:20,000 --> 00:01:23,500
Hello world!

2
00:01:24,123 --> 00:01:26,789
Second line of subtitles
With two lines`;

    const vtt = convertSrtToVtt(srt);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:01:20.000 --> 00:01:23.500");
    expect(vtt).toContain("00:01:24.123 --> 00:01:26.789");
    expect(vtt).toContain("Hello world!");
    expect(vtt).toContain("Second line of subtitles\nWith two lines");
  });

  it("handles single-digit hours and BOM", () => {
    const srtWithBom = `\uFEFF1\r\n0:01:20,500 --> 0:01:23,500\r\nTest text`;
    const vtt = convertSrtToVtt(srtWithBom);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:01:20.500 --> 00:01:23.500");
    expect(vtt).toContain("Test text");
  });

  it("preserves already converted WebVTT", () => {
    const existingVtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAlready VTT";
    const vtt = convertSrtToVtt(existingVtt);
    expect(vtt).toBe(existingVtt);
  });
});

describe("ASS to WebVTT conversion", () => {
  it("converts ASS dialogue lines into WebVTT cues", () => {
    const ass = `[Script Info]
Title: Sample ASS
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:01:20.00,0:01:23.50,Default,,0,0,0,,Hello ASS world!
Dialogue: 0,0:01:24.12,0:01:26.78,Default,,0,0,0,,{\\pos(192,200)}Second line\\Nwith break
Dialogue: 0,0:01:28.00,0:01:30.00,Default,,0,0,0,,{\\b1}Bold text{\\b0} and {\\i1}italics{\\i0}`;

    const vtt = convertAssToVtt(ass);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    // Centisecond conversions
    expect(vtt).toContain("00:01:20.000 --> 00:01:23.500");
    expect(vtt).toContain("00:01:24.120 --> 00:01:26.780");
    expect(vtt).toContain("00:01:28.000 --> 00:01:30.000");

    // Text cleaning
    expect(vtt).toContain("Hello ASS world!");
    expect(vtt).toContain("Second line\nwith break");
    expect(vtt).toContain("<b>Bold text</b> and <i>italics</i>");
    expect(vtt).not.toContain("{\\pos");
  });

  it("handles empty or malformed ASS gracefully", () => {
    expect(convertAssToVtt("")).toBe("WEBVTT\n\n");
    expect(convertAssToVtt("[Script Info]\nTitle: Test")).toBe("WEBVTT\n\n");
  });
});

describe("ensureWebVtt helper", () => {
  it("detects and converts formats appropriately", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nSRT Content";
    expect(ensureWebVtt(srt)).toContain("00:00:01.000 --> 00:00:02.000");

    const ass = "[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:00:01.00,0:00:02.00,ASS Content";
    expect(ensureWebVtt(ass)).toContain("00:00:01.000 --> 00:00:02.000");

    const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nVTT Content";
    expect(ensureWebVtt(vtt)).toBe(vtt);
  });
});

describe("Subtitle proxy security validation", () => {
  it("allows valid public http and https URLs", () => {
    expect(validateSubtitleUrl("https://download.opensubtitles.org/sub.vtt").valid).toBe(true);
    expect(validateSubtitleUrl("http://subs5.strem.io/download/123.srt").valid).toBe(true);
  });

  it("blocks dangerous schemes", () => {
    expect(validateSubtitleUrl("file:///etc/passwd").valid).toBe(false);
    expect(validateSubtitleUrl("ftp://server/file.srt").valid).toBe(false);
    expect(validateSubtitleUrl("javascript:alert(1)").valid).toBe(false);
  });

  it("blocks private, link-local, and loopback IPs (SSRF protection)", () => {
    expect(validateSubtitleUrl("http://localhost/secret.srt").valid).toBe(false);
    expect(validateSubtitleUrl("http://127.0.0.1/admin.srt").valid).toBe(false);
    expect(validateSubtitleUrl("http://10.0.0.1/sub.srt").valid).toBe(false);
    expect(validateSubtitleUrl("http://192.168.1.1/sub.srt").valid).toBe(false);
    expect(validateSubtitleUrl("http://172.16.0.1/sub.srt").valid).toBe(false);
    expect(validateSubtitleUrl("http://169.254.169.254/latest/meta-data").valid).toBe(false);
  });
});
