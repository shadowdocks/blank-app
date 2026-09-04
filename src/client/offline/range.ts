import type { ByteRange } from "./types";

/**
 * Parses an incoming HTTP Range header (e.g. "bytes=0-1048575", "bytes=1048576-", "bytes=-500").
 * Returns the normalized 0-indexed inclusive ByteRange, or null if invalid or unsatisfiable.
 */
export function parseRangeHeader(
  rangeHeader: string | null | undefined,
  totalSize: number
): ByteRange | null {
  if (!rangeHeader || typeof rangeHeader !== "string") return null;
  const trimmed = rangeHeader.trim();
  if (!trimmed.startsWith("bytes=")) return null;

  const spec = trimmed.slice(6).trim();
  // Multi-range is not supported
  if (spec.includes(",")) return null;

  const dashIdx = spec.indexOf("-");
  if (dashIdx === -1) return null;

  const startStr = spec.slice(0, dashIdx).trim();
  const endStr = spec.slice(dashIdx + 1).trim();

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: bytes=-N means the final N bytes
    if (endStr === "") return null;
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    if (totalSize <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = parseInt(startStr, 10);
    if (!Number.isFinite(start) || start < 0) return null;

    if (endStr === "") {
      // Open-ended: bytes=N-
      end = totalSize > 0 ? totalSize - 1 : start;
    } else {
      end = parseInt(endStr, 10);
      if (!Number.isFinite(end) || end < start) return null;
    }
  }

  if (totalSize > 0) {
    if (start >= totalSize) return null;
    end = Math.min(end, totalSize - 1);
  }

  return { start, end };
}

/**
 * Parses an HTTP Content-Range response header (e.g. "bytes 0-1048575/524288000" or "bytes 0-1048575/*").
 */
export function parseContentRangeHeader(
  header: string | null | undefined
): { start: number; end: number; total: number | null } | null {
  if (!header || typeof header !== "string") return null;
  const match = header.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/);
  if (!match) return null;

  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  const total = match[3] === "*" ? null : parseInt(match[3], 10);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0) {
    return null;
  }

  if (total !== null && (!Number.isFinite(total) || total <= 0 || end >= total)) {
    return null;
  }

  return { start, end, total };
}

export function formatRangeHeader(start: number, end?: number): string {
  if (end === undefined) {
    return `bytes=${start}-`;
  }
  return `bytes=${start}-${end}`;
}

export function formatContentRangeHeader(
  start: number,
  end: number,
  total: number | null
): string {
  return `bytes ${start}-${end}/${total !== null ? total : "*"}`;
}

export interface ChunkPlan {
  index: number;
  start: number;
  end: number;
  size: number;
}

/**
 * Generates the sequence of byte-range chunks required to cover `totalBytes` using `chunkSize`.
 */
export function calculateChunkPlan(
  totalBytes: number,
  chunkSize: number
): ChunkPlan[] {
  if (totalBytes <= 0 || chunkSize <= 0) return [];

  const chunks: ChunkPlan[] = [];
  const count = Math.ceil(totalBytes / chunkSize);

  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize - 1, totalBytes - 1);
    chunks.push({
      index: i,
      start,
      end,
      size: end - start + 1,
    });
  }

  return chunks;
}

export function getChunkIndexForByte(byteOffset: number, chunkSize: number): number {
  if (chunkSize <= 0 || byteOffset < 0) return 0;
  return Math.floor(byteOffset / chunkSize);
}

export function getChunkByteRange(
  index: number,
  chunkSize: number,
  totalBytes: number
): ByteRange | null {
  if (index < 0 || chunkSize <= 0 || totalBytes <= 0) return null;
  const start = index * chunkSize;
  if (start >= totalBytes) return null;
  const end = Math.min((index + 1) * chunkSize - 1, totalBytes - 1);
  return { start, end };
}

/**
 * Merges overlapping or contiguous byte ranges into a sorted, disjoint list of ranges.
 */
export function mergeByteRanges(ranges: ByteRange[]): ByteRange[] {
  if (!ranges.length) return [];

  // Filter valid ranges and sort by start ascending
  const valid = ranges
    .filter((r) => r && typeof r.start === "number" && typeof r.end === "number" && r.start <= r.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!valid.length) return [];

  const merged: ByteRange[] = [{ start: valid[0].start, end: valid[0].end }];

  for (let i = 1; i < valid.length; i++) {
    const curr = valid[i];
    const prev = merged[merged.length - 1];

    // Overlapping or strictly adjacent: prev.end + 1 >= curr.start
    if (curr.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ start: curr.start, end: curr.end });
    }
  }

  return merged;
}

/**
 * Calculates total number of completed bytes represented by a list of byte ranges.
 */
export function calculateCompletedBytes(ranges: ByteRange[]): number {
  const merged = mergeByteRanges(ranges);
  return merged.reduce((acc, r) => acc + (r.end - r.start + 1), 0);
}

/**
 * Given total bytes and completed ranges, returns the list of missing byte ranges.
 */
export function calculateMissingRanges(
  totalBytes: number,
  completedRanges: ByteRange[]
): ByteRange[] {
  if (totalBytes <= 0) return [];
  const merged = mergeByteRanges(completedRanges);
  if (!merged.length) {
    return [{ start: 0, end: totalBytes - 1 }];
  }

  const missing: ByteRange[] = [];
  let pointer = 0;

  for (const range of merged) {
    if (range.start > pointer) {
      missing.push({ start: pointer, end: Math.min(range.start - 1, totalBytes - 1) });
    }
    pointer = Math.max(pointer, range.end + 1);
    if (pointer >= totalBytes) break;
  }

  if (pointer < totalBytes) {
    missing.push({ start: pointer, end: totalBytes - 1 });
  }

  return missing;
}

/**
 * Checks if a requested byte range is completely covered by completed ranges.
 */
export function isByteRangeSatisfied(
  requested: ByteRange,
  completedRanges: ByteRange[]
): boolean {
  if (requested.start > requested.end || requested.start < 0) return false;
  const merged = mergeByteRanges(completedRanges);

  for (const range of merged) {
    if (range.start <= requested.start && range.end >= requested.end) {
      return true;
    }
  }

  return false;
}
