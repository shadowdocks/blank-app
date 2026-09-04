import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const root = new URL("../../dist/", import.meta.url);

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function assetName(pathname: string): string {
  const mounted = pathname.lastIndexOf("/~/+/");
  const relative = mounted >= 0 ? pathname.slice(mounted + 5) : pathname.replace(/^\/+/, "");
  return relative && /\.[a-z0-9]+$/i.test(relative) ? relative : "index.html";
}

function cacheControl(name: string): string {
  if (name === "index.html" || name === "service-worker.js" || name === "manifest.webmanifest") {
    return "no-cache";
  }
  if (name.startsWith("assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=86400";
}

export async function staticResponse(pathname: string): Promise<Response> {
  let name: string;
  try {
    name = decodeURIComponent(assetName(pathname));
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const target = new URL(name, root);
  if (!target.href.startsWith(root.href)) return Response.json({ error: "Not found." }, { status: 404 });

  try {
    const body = await readFile(target);
    return new Response(body, {
      headers: {
        "cache-control": cacheControl(name),
        "content-type": contentTypes[extname(name)] ?? "application/octet-stream",
      },
    });
  } catch {
    return name === "index.html"
      ? Response.json({ error: "Application build not found." }, { status: 503 })
      : Response.json({ error: "Not found." }, { status: 404 });
  }
}
