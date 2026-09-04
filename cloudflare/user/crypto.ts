const PBKDF2_ITERATIONS = 100_000;
const HASH_VERSION = "v1";
const SALT_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;

export const DUMMY_PASSWORD_HASH =
  "v1$100000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000";

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array | null {
  if (typeof hex !== "string" || hex.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const val = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(val)) {
      return null;
    }
    bytes[i / 2] = val;
  }
  return bytes;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.byteLength; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BYTE_LENGTH * 8
  );

  const saltHex = bytesToHex(salt);
  const hashHex = bytesToHex(new Uint8Array(derived));
  return `${HASH_VERSION}$${PBKDF2_ITERATIONS}$${saltHex}$${hashHex}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (typeof password !== "string" || typeof encodedHash !== "string") {
    return false;
  }

  const parts = encodedHash.split("$");
  if (parts.length !== 4) {
    return false;
  }

  const [version, iterationsStr, saltHex, hashHex] = parts;
  if (version !== HASH_VERSION) {
    return false;
  }

  const iterations = parseInt(iterationsStr, 10);
  if (!Number.isFinite(iterations) || iterations < 1) {
    return false;
  }

  const salt = hexToBytes(saltHex);
  const expectedHash = hexToBytes(hashHex);
  if (!salt || salt.byteLength !== SALT_BYTE_LENGTH) {
    return false;
  }
  if (!expectedHash || expectedHash.byteLength !== KEY_BYTE_LENGTH) {
    return false;
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_BYTE_LENGTH * 8
  );

  const derivedHash = new Uint8Array(derived);
  return timingSafeEqual(derivedHash, expectedHash);
}

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256-bit
  return bytesToHex(bytes);
}

export async function hashSessionToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return bytesToHex(new Uint8Array(digest));
}

export function generateId(): string {
  return crypto.randomUUID();
}
