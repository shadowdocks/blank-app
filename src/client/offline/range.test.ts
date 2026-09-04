import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRangeHeader,
  parseContentRangeHeader,
  formatRangeHeader,
  formatContentRangeHeader,
  calculateChunkPlan,
  getChunkIndexForByte,
  getChunkByteRange,
  mergeByteRanges,
  calculateCompletedBytes,
  calculateMissingRanges,
  isByteRangeSatisfied,
} from "./range";

describe("range and chunk math helpers", () => {
  describe("parseRangeHeader", () => {
    it("parses valid closed range", () => {
      const res = parseRangeHeader("bytes=0-499", 1000);
      assert.deepEqual(res, { start: 0, end: 499 });
    });

    it("parses open-ended start range", () => {
      const res = parseRangeHeader("bytes=500-", 1000);
      assert.deepEqual(res, { start: 500, end: 999 });
    });

    it("parses suffix range", () => {
      const res = parseRangeHeader("bytes=-300", 1000);
      assert.deepEqual(res, { start: 700, end: 999 });
    });

    it("returns null for invalid syntax or wrong unit", () => {
      assert.equal(parseRangeHeader("items=0-10", 1000), null);
      assert.equal(parseRangeHeader("bytes=", 1000), null);
      assert.equal(parseRangeHeader(null, 1000), null);
      assert.equal(parseRangeHeader("garbage", 1000), null);
    });

    it("returns null when start is beyond total size", () => {
      assert.equal(parseRangeHeader("bytes=1500-2000", 1000), null);
    });

    it("clamps end if end exceeds total size", () => {
      const res = parseRangeHeader("bytes=500-2000", 1000);
      assert.deepEqual(res, { start: 500, end: 999 });
    });

    it("returns null if start > end", () => {
      assert.equal(parseRangeHeader("bytes=500-400", 1000), null);
    });
  });

  describe("parseContentRangeHeader", () => {
    it("parses standard Content-Range", () => {
      const res = parseContentRangeHeader("bytes 0-499/1000");
      assert.deepEqual(res, { start: 0, end: 499, total: 1000 });
    });

    it("parses Content-Range with unknown total", () => {
      const res = parseContentRangeHeader("bytes 0-499/*");
      assert.deepEqual(res, { start: 0, end: 499, total: null });
    });

    it("returns null for unsatisfied or invalid Content-Range", () => {
      assert.equal(parseContentRangeHeader("bytes */1000"), null);
      assert.equal(parseContentRangeHeader("invalid"), null);
    });
  });

  describe("formatting headers", () => {
    it("formats range header", () => {
      assert.equal(formatRangeHeader(0, 499), "bytes=0-499");
      assert.equal(formatRangeHeader(500), "bytes=500-");
    });

    it("formats content-range header", () => {
      assert.equal(formatContentRangeHeader(0, 499, 1000), "bytes 0-499/1000");
      assert.equal(formatContentRangeHeader(0, 499, null), "bytes 0-499/*");
    });
  });

  describe("calculateChunkPlan", () => {
    it("splits file into uniform chunks with a smaller tail", () => {
      const plan = calculateChunkPlan(2500, 1000);
      assert.equal(plan.length, 3);

      assert.deepEqual(plan[0], { index: 0, start: 0, end: 999, size: 1000 });
      assert.deepEqual(plan[1], { index: 1, start: 1000, end: 1999, size: 1000 });
      assert.deepEqual(plan[2], { index: 2, start: 2000, end: 2499, size: 500 });
    });

    it("handles 0 bytes", () => {
      const plan = calculateChunkPlan(0, 1000);
      assert.equal(plan.length, 0);
    });

    it("handles exact chunk multiple", () => {
      const plan = calculateChunkPlan(2000, 1000);
      assert.equal(plan.length, 2);
      assert.deepEqual(plan[0], { index: 0, start: 0, end: 999, size: 1000 });
      assert.deepEqual(plan[1], { index: 1, start: 1000, end: 1999, size: 1000 });
    });
  });

  describe("getChunkIndexForByte and getChunkByteRange", () => {
    it("finds correct chunk index", () => {
      assert.equal(getChunkIndexForByte(0, 1000), 0);
      assert.equal(getChunkIndexForByte(999, 1000), 0);
      assert.equal(getChunkIndexForByte(1000, 1000), 1);
      assert.equal(getChunkIndexForByte(2499, 1000), 2);
    });

    it("calculates chunk byte bounds correctly", () => {
      assert.deepEqual(getChunkByteRange(0, 1000, 2500), { start: 0, end: 999 });
      assert.deepEqual(getChunkByteRange(1, 1000, 2500), { start: 1000, end: 1999 });
      assert.deepEqual(getChunkByteRange(2, 1000, 2500), { start: 2000, end: 2499 });
    });
  });

  describe("mergeByteRanges", () => {
    it("merges contiguous and overlapping ranges", () => {
      const merged = mergeByteRanges([
        { start: 0, end: 100 },
        { start: 101, end: 200 },
        { start: 300, end: 400 },
        { start: 350, end: 500 },
      ]);
      assert.deepEqual(merged, [
        { start: 0, end: 200 },
        { start: 300, end: 500 },
      ]);
    });

    it("handles empty and unsorted input", () => {
      assert.deepEqual(mergeByteRanges([]), []);
      const merged = mergeByteRanges([
        { start: 400, end: 500 },
        { start: 100, end: 200 },
        { start: 201, end: 300 },
      ]);
      assert.deepEqual(merged, [
        { start: 100, end: 300 },
        { start: 400, end: 500 },
      ]);
    });
  });

  describe("calculateCompletedBytes and missing ranges", () => {
    it("sums merged completed bytes accurately", () => {
      const ranges = [
        { start: 0, end: 99 },   // 100 bytes
        { start: 50, end: 199 }, // overlapping -> 0-199 = 200 bytes
        { start: 300, end: 399 },// 100 bytes
      ];
      assert.equal(calculateCompletedBytes(ranges), 300);
    });

    it("calculates missing byte ranges", () => {
      const completed = [
        { start: 0, end: 99 },
        { start: 200, end: 299 },
      ];
      const missing = calculateMissingRanges(500, completed);
      assert.deepEqual(missing, [
        { start: 100, end: 199 },
        { start: 300, end: 499 },
      ]);
    });

    it("checks whether requested range is fully satisfied", () => {
      const completed = [{ start: 0, end: 500 }];
      assert.equal(isByteRangeSatisfied({ start: 0, end: 200 }, completed), true);
      assert.equal(isByteRangeSatisfied({ start: 100, end: 400 }, completed), true);
      assert.equal(isByteRangeSatisfied({ start: 400, end: 600 }, completed), false);
      assert.equal(isByteRangeSatisfied({ start: 0, end: 10 }, []), false);
    });
  });
});
