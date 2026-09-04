import { describe, expect, it } from "bun:test";
import {
  bytesToHex,
  DUMMY_PASSWORD_HASH,
  generateId,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  hexToBytes,
  timingSafeEqual,
  verifyPassword,
} from "../crypto";

describe("crypto", () => {
  describe("hex encoding", () => {
    it("converts bytes to hex and back", () => {
      const original = new Uint8Array([0, 15, 16, 255, 128, 42]);
      const hex = bytesToHex(original);
      expect(hex).toBe("000f10ff802a");
      const roundtrip = hexToBytes(hex);
      expect(roundtrip).not.toBeNull();
      expect(Array.from(roundtrip!)).toEqual(Array.from(original));
    });

    it("rejects invalid hex strings", () => {
      expect(hexToBytes("abc")).toBeNull(); // odd length
      expect(hexToBytes("zz")).toBeNull(); // non-hex
    });
  });

  describe("timingSafeEqual", () => {
    it("returns true for matching buffers", () => {
      const a = new Uint8Array([1, 2, 3, 4]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it("returns false for different buffers or lengths", () => {
      const a = new Uint8Array([1, 2, 3, 4]);
      const b = new Uint8Array([1, 2, 3, 5]);
      const c = new Uint8Array([1, 2, 3]);
      expect(timingSafeEqual(a, b)).toBe(false);
      expect(timingSafeEqual(a, c)).toBe(false);
    });
  });

  describe("session tokens", () => {
    it("generates 256-bit random tokens (64 hex characters)", () => {
      const token1 = generateSessionToken();
      const token2 = generateSessionToken();
      expect(token1.length).toBe(64);
      expect(token2.length).toBe(64);
      expect(token1).not.toBe(token2);
      expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);
    });

    it("hashes session token deterministically with SHA-256", async () => {
      const token = generateSessionToken();
      const hash1 = await hashSessionToken(token);
      const hash2 = await hashSessionToken(token);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(hash1).not.toBe(token);
    });
  });

  describe("password hashing with PBKDF2-SHA-256", () => {
    it("hashes and verifies password correctly", async () => {
      const password = "SuperSecretPassword123!";
      const hash = await hashPassword(password);

      expect(hash.startsWith("v1$100000$")).toBe(true);
      const parts = hash.split("$");
      expect(parts.length).toBe(4);
      expect(parts[0]).toBe("v1");
      expect(parts[1]).toBe("100000");
      expect(parts[2].length).toBe(32); // 16 bytes salt
      expect(parts[3].length).toBe(64); // 32 bytes hash

      const isMatch = await verifyPassword(password, hash);
      expect(isMatch).toBe(true);

      const isMismatch = await verifyPassword("WrongPassword123!", hash);
      expect(isMismatch).toBe(false);
    });

    it("uses unique salts for same password", async () => {
      const password = "identicalPassword999";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);
      expect(hash1).not.toBe(hash2);

      expect(await verifyPassword(password, hash1)).toBe(true);
      expect(await verifyPassword(password, hash2)).toBe(true);
    });

    it("safely handles corrupted or invalid hash strings", async () => {
      expect(await verifyPassword("test", "")).toBe(false);
      expect(await verifyPassword("test", "v2$100000$salt$hash")).toBe(false);
      expect(await verifyPassword("test", "v1$bad$salt$hash")).toBe(false);
      expect(await verifyPassword("test", "v1$100000$short$hash")).toBe(false);
      expect(await verifyPassword("test", "not-a-hash")).toBe(false);
    });

    it("verifies DUMMY_PASSWORD_HASH safely without errors and returns false", async () => {
      expect(DUMMY_PASSWORD_HASH.startsWith("v1$100000$")).toBe(true);
      const isMatch = await verifyPassword("AnyPassword123!", DUMMY_PASSWORD_HASH);
      expect(isMatch).toBe(false);
    });
  });

  describe("generateId", () => {
    it("generates valid UUIDs", () => {
      const id = generateId();
      expect(id.length).toBe(36);
      expect(/^[0-9a-f-]{36}$/.test(id)).toBe(true);
    });
  });
});
