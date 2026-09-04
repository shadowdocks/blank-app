import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { recommend } from "./recommend";
import { search, titleDetails } from "./catalog";
import { sources } from "./sources";
import { startTorrent, streamTorrent, torrentDiagnostics, torrentStatus } from "./torrent";

const root = new URL("../dist/", import.meta.url);
const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

async function staticFile(pathname: string): Promise<Response> {
  const name = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
  const target = new URL(name, root);
  if (!target.href.startsWith(root.href)) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    const body = await readFile(target);
    return new Response(body, {
      headers: {
        "cache-control": name === "index.html" ? "no-cache" : "public, max-age=31536000, immutable",
        "content-type": contentTypes[extname(name)] ?? "application/octet-stream",
      },
    });
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
}

async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", revision: process.env.HAWK_REVISION ?? null });
    }
    if (url.pathname === "/api/recommend" && request.method === "GET") return recommend(url);
    if (url.pathname === "/api/search" && request.method === "GET") return search(url);
    if (url.pathname === "/api/title" && request.method === "GET") return titleDetails(url);
    if (url.pathname === "/api/sources" && request.method === "GET") return sources(url);
    if (url.pathname === "/api/torrents" && request.method === "POST") {
      try {
        const body = await request.json() as { magnet?: string };
        return await startTorrent(body.magnet ?? "", request.signal);
      } catch {
        return Response.json({ error: "Invalid request body." }, { status: 400 });
      }
    }
    const status = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})$/i.exec(url.pathname);
    if (status && request.method === "GET") return await torrentStatus(status[1]);
    const diagnostic = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})\/diagnostics$/i.exec(url.pathname);
    if (diagnostic && request.method === "GET") return await torrentDiagnostics(diagnostic[1]);
    const stream = /^\/api\/stream\/([a-f0-9]{40}|[2-7a-z]{32})\/(\d+)$/i.exec(url.pathname);
    if (stream && (request.method === "GET" || request.method === "HEAD")) return await streamTorrent(request, stream[1], stream[2]);
    const builtAsset = url.pathname.match(/(\/assets\/[^/]+)$/)?.[1];
    const publicAsset = url.pathname.match(/\/([^/]+\.[a-z0-9]+)$/i)?.[1];
    return staticFile(builtAsset ?? (publicAsset ? `/${publicAsset}` : "/index.html"));
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => {
    if (!response.writableEnded) abort();
  });
  try {
    const incoming = new Request(
      `http://127.0.0.1:${process.env.PORT ?? 9000}${request.url ?? "/"}`,
      { method: request.method, headers: request.headers as HeadersInit, body: await bodyOf(request), signal: controller.signal },
    );
    const outgoing = await handle(incoming);
    response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
    if (!outgoing.body || request.method === "HEAD") {
      if (outgoing.body) void outgoing.body.cancel();
      return response.end();
    }
    const stream = Readable.fromWeb(outgoing.body as import("node:stream/web").ReadableStream);
    response.on("close", () => {
      if (!response.writableEnded) stream.destroy();
    });
    stream.on("error", (error) => {
      console.error("event=stream_error", error);
      response.destroy();
    });
    stream.pipe(response);
  } catch (error) {
    console.error("event=http_error", error);
    if (!response.headersSent) response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Internal server error." }));
  }
}

const port = Number(process.env.PORT ?? 9000);
const server = createServer((request, response) => {
  void serve(request, response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`event=hawk_listening url=http://127.0.0.1:${port}`);
});
