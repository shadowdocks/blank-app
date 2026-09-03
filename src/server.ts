import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { recommend } from "./recommend";
import { sources } from "./sources";
import { startTorrent, streamTorrent, torrentStatus } from "./torrent";

const root = new URL("../public/", import.meta.url);

async function staticFile(name: string, type: string): Promise<Response> {
  return new Response(await readFile(new URL(name, root)), { headers: { "content-type": type } });
}

async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ status: "ok" });
    if (url.pathname === "/api/recommend" && request.method === "GET") return recommend(url);
    if (url.pathname === "/api/sources" && request.method === "GET") return sources(url);
    if (url.pathname === "/api/torrents" && request.method === "POST") {
      try {
        const body = await request.json() as { magnet?: string };
        return startTorrent(body.magnet ?? "");
      } catch {
        return Response.json({ error: "Invalid request body." }, { status: 400 });
      }
    }
    const status = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})$/i.exec(url.pathname);
    if (status && request.method === "GET") return torrentStatus(status[1]);
    const stream = /^\/api\/stream\/([a-f0-9]{40}|[2-7a-z]{32})\/(\d+)$/i.exec(url.pathname);
    if (stream && (request.method === "GET" || request.method === "HEAD")) return streamTorrent(request, stream[1], stream[2]);
    if (url.pathname === "/" || url.pathname === "/index.html") return staticFile("index.html", "text/html; charset=utf-8");
    if (url.pathname === "/styles.css") return staticFile("styles.css", "text/css; charset=utf-8");
    if (url.pathname === "/app.js") return staticFile("app.js", "text/javascript; charset=utf-8");
    return Response.json({ error: "Not found." }, { status: 404 });
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const incoming = new Request(
      `http://127.0.0.1:${process.env.PORT ?? 9000}${request.url ?? "/"}`,
      { method: request.method, headers: request.headers as HeadersInit, body: await bodyOf(request) },
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
