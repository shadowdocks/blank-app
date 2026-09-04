import { describe, expect, it } from "bun:test";
import { handle, normalizePathname } from "../server";

describe("Server Mount Normalization", () => {
  it("normalizes root and unprefixed API paths", () => {
    expect(normalizePathname("/")).toBe("/");
    expect(normalizePathname("/health")).toBe("/health");
    expect(normalizePathname("/api/playback")).toBe("/api/playback");
    expect(normalizePathname("/api/sources")).toBe("/api/sources");
    expect(
      normalizePathname("/api/stream/1111111111111111111111111111111111111111/0")
    ).toBe("/api/stream/1111111111111111111111111111111111111111/0");
  });

  it("normalizes Streamlit /~/+/ mount prefixes before API and stream routes", () => {
    expect(normalizePathname("/~/+/")).toBe("/");
    expect(normalizePathname("/~/+")).toBe("/");
    expect(normalizePathname("/~/+/health")).toBe("/health");
    expect(normalizePathname("/~/+/api/sources")).toBe("/api/sources");
    expect(normalizePathname("/~/+/api/playback")).toBe("/api/playback");
    expect(normalizePathname("/~/+/api/playback/hash123")).toBe("/api/playback/hash123");
    expect(
      normalizePathname("/~/+/api/stream/1111111111111111111111111111111111111111/0")
    ).toBe("/api/stream/1111111111111111111111111111111111111111/0");
    expect(
      normalizePathname("/submount/~/+/api/sources/health")
    ).toBe("/api/sources/health");
  });

  it("dispatches API health route with /~/+/ prefix to API handler instead of static fallback", async () => {
    const directReq = new Request("http://127.0.0.1:9000/health");
    const directRes = await handle(directReq);
    expect(directRes.status).toBe(200);
    const directBody = (await directRes.json()) as any;
    expect(directBody.status).toBe("ok");

    const mountedReq = new Request("http://127.0.0.1:9000/~/+/health");
    const mountedRes = await handle(mountedReq);
    expect(mountedRes.status).toBe(200);
    const mountedBody = (await mountedRes.json()) as any;
    expect(mountedBody.status).toBe("ok");
  });

  it("dispatches /~/+/api/sources/health to API instead of static index.html", async () => {
    const req = new Request("http://127.0.0.1:9000/~/+/api/sources/health");
    const res = await handle(req);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body.providers).toBeDefined();
    expect(body.status).toBeDefined();
  });

  it("preserves static fallback behavior for non-API mounted paths", async () => {
    const rootReq = new Request("http://127.0.0.1:9000/~/+/");
    const rootRes = await handle(rootReq);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get("content-type")).toContain("text/html");
  });
});
