import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createDownloadManifest,
  applyChunkCompletion,
  applyStatusTransition,
  applySubtitleCompletion,
  applyArtworkCompletion,
  isDownloadComplete,
  calculateManifestProgress,
} from "./manifest";

describe("manifest state transitions", () => {
  it("initializes a valid manifest", () => {
    const manifest = createDownloadManifest({
      id: "media-1",
      title: "Big Buck Bunny",
      mediaType: "movie",
      year: 2008,
      mediaUrl: "https://example.com/stream/bbb.mp4",
      totalBytes: 10_000_000,
      chunkSize: 1_000_000,
      subtitles: [
        { id: "sub-en", label: "English", language: "en", url: "https://example.com/sub.vtt" },
      ],
      posterUrl: "https://example.com/poster.jpg",
    });

    assert.equal(manifest.id, "media-1");
    assert.equal(manifest.status, "idle");
    assert.equal(manifest.totalBytes, 10_000_000);
    assert.equal(manifest.downloadedBytes, 0);
    assert.equal(manifest.completedRanges.length, 0);
    assert.equal(manifest.subtitles.length, 1);
    assert.equal(manifest.subtitles[0].downloaded, false);
    assert.equal(manifest.artwork.posterUrl, "https://example.com/poster.jpg");
    assert.equal(manifest.artwork.downloadedPoster, false);
  });

  it("uses download-sized chunks by default", () => {
    const manifest = createDownloadManifest({
      id: "media-default-chunks",
      title: "Test",
      mediaType: "movie",
      mediaUrl: "https://example.com/stream/test.mp4",
      totalBytes: 64 * 1024 * 1024,
    });

    assert.equal(manifest.chunkSize, 16 * 1024 * 1024);
  });

  it("updates progress when chunks complete", () => {
    let manifest = createDownloadManifest({
      id: "test",
      title: "Test",
      mediaType: "movie",
      mediaUrl: "https://example.com/stream",
      totalBytes: 1000,
      chunkSize: 500,
    });

    manifest = applyStatusTransition(manifest, "downloading");

    // Chunk 0 (0-499) completes
    manifest = applyChunkCompletion(manifest, { start: 0, end: 499 });
    assert.equal(manifest.downloadedBytes, 500);
    assert.deepEqual(manifest.completedRanges, [{ start: 0, end: 499 }]);
    assert.equal(manifest.status, "downloading");

    // Chunk 1 (500-999) completes
    manifest = applyChunkCompletion(manifest, { start: 500, end: 999 });
    assert.equal(manifest.downloadedBytes, 1000);
    assert.deepEqual(manifest.completedRanges, [{ start: 0, end: 999 }]);
    // If no subtitles or artwork pending, it should be complete
    assert.equal(manifest.status, "completed");
    assert.equal(isDownloadComplete(manifest), true);
  });

  it("considers subtitles and artwork for completion", () => {
    let manifest = createDownloadManifest({
      id: "test-aux",
      title: "Test Aux",
      mediaType: "movie",
      mediaUrl: "https://example.com/stream",
      totalBytes: 1000,
      chunkSize: 1000,
      subtitles: [
        { id: "sub-1", label: "English", language: "en", url: "https://example.com/en.vtt" },
      ],
      posterUrl: "https://example.com/poster.jpg",
    });

    manifest = applyStatusTransition(manifest, "downloading");

    // Media completes
    manifest = applyChunkCompletion(manifest, { start: 0, end: 999 });
    assert.equal(manifest.status, "downloading"); // Not completed yet because aux pending
    assert.equal(isDownloadComplete(manifest), false);

    // Subtitle completes
    manifest = applySubtitleCompletion(manifest, "sub-1", 1024, "text/vtt");
    assert.equal(manifest.subtitles[0].downloaded, true);
    assert.equal(manifest.subtitles[0].size, 1024);
    assert.equal(isDownloadComplete(manifest), false);

    // Artwork completes
    manifest = applyArtworkCompletion(manifest, "poster", "image/jpeg");
    assert.equal(manifest.artwork.downloadedPoster, true);
    assert.equal(isDownloadComplete(manifest), true);
    assert.equal(manifest.status, "completed");
  });

  it("handles pause, resume, cancel, error state transitions", () => {
    let manifest = createDownloadManifest({
      id: "state-test",
      title: "State",
      mediaType: "movie",
      mediaUrl: "https://example.com/stream",
      totalBytes: 1000,
    });

    manifest = applyStatusTransition(manifest, "paused");
    assert.equal(manifest.status, "paused");

    manifest = applyStatusTransition(manifest, "downloading");
    assert.equal(manifest.status, "downloading");

    manifest = applyStatusTransition(manifest, "error", "Network offline");
    assert.equal(manifest.status, "error");
    assert.equal(manifest.error, "Network offline");

    manifest = applyStatusTransition(manifest, "cancelled");
    assert.equal(manifest.status, "cancelled");
  });

  it("calculates progress percentage correctly", () => {
    const manifest = createDownloadManifest({
      id: "pct-test",
      title: "Pct",
      mediaType: "movie",
      mediaUrl: "https://example.com/stream",
      totalBytes: 2000,
      chunkSize: 500,
    });

    const updated = applyChunkCompletion(manifest, { start: 0, end: 499 });
    const progress = calculateManifestProgress(updated);
    assert.equal(progress.percent, 25);
    assert.equal(progress.downloadedBytes, 500);
    assert.equal(progress.totalBytes, 2000);
    assert.equal(progress.isComplete, false);
  });
});
