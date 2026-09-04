import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { accessEnd, logLine } from "./access-log";
import type { MediaTarget } from "./shared/playback";
import { findSources, handleSourcesHealthRequest, handleSourcesRequest } from "./server/sources";
import { fetchOpenSubtitles, handleSubtitleProxyRequest } from "./server/subtitles";
import {
  deleteTorrent,
  startTorrent,
  streamTorrent,
  streamTorrentSubtitle,
  torrentDiagnostics,
  torrentStatus,
} from "./server/torrents";
import { staticResponse } from "./server/static";

let requestSequence = 0;

export function normalizePathname(pathname: string): string {
  const mounted = pathname.lastIndexOf("/~/+/");
  if (mounted >= 0) {
    return pathname.slice(mounted + 4);
  }
  if (pathname === "/~/+" || pathname.endsWith("/~/+")) {
    return "/";
  }
  return pathname;
}

async function bodyOf(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > 1024 * 1024) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function mediaTarget(value: unknown): MediaTarget | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<MediaTarget>;
  if (
    !/^tt\d{7,10}$/.test(item.imdbId ?? "") ||
    (item.mediaType !== "movie" && item.mediaType !== "tv") ||
    typeof item.title !== "string" ||
    !item.title.trim() ||
    item.title.length > 300
  ) return null;
  const numberOrNull = (candidate: unknown, minimum: number, maximum: number) =>
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= minimum && candidate <= maximum
      ? candidate
      : null;
  return {
    imdbId: item.imdbId!,
    mediaType: item.mediaType,
    title: item.title.trim(),
    year: numberOrNull(item.year, 1870, new Date().getFullYear() + 5),
    season: numberOrNull(item.season, 0, 1_000),
    episode: numberOrNull(item.episode, 0, 100_000),
    episodeTitle: typeof item.episodeTitle === "string" ? item.episodeTitle.slice(0, 300) : null,
  };
}

function mediaTargetFromUrl(url: URL): MediaTarget | null {
  return mediaTarget({
    imdbId: url.searchParams.get("imdbId"),
    mediaType: url.searchParams.get("mediaType"),
    title: url.searchParams.get("title"),
    year: Number(url.searchParams.get("year")) || null,
    season: Number(url.searchParams.get("season")) || null,
    episode: Number(url.searchParams.get("episode")) || null,
    episodeTitle: url.searchParams.get("episodeTitle"),
  });
}

async function createPlayback(request: Request): Promise<Response> {
  let body: { magnet?: string; fileIndex?: number | null; source?: { magnet?: string; fileIndex?: number | null }; target?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  const target = mediaTarget(body.target);
  if (!target) return Response.json({ error: "Valid media details are required." }, { status: 400 });
  let magnet = body.magnet ?? body.source?.magnet ?? "";
  if (!magnet) {
    const [best] = await findSources(target, { signal: request.signal });
    magnet = best?.magnet ?? "";
  }
  if (!magnet) return Response.json({ error: "No streams found." }, { status: 404 });
  const preferredFileIndex = body.source?.fileIndex ?? body.fileIndex ?? null;
  return startTorrent(magnet, request.signal, target, preferredFileIndex);
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pathname = normalizePathname(url.pathname);
  if (pathname === "/health") {
    return Response.json({ status: "ok", revision: process.env.HAWK_REVISION ?? null });
  }
  if (pathname === "/api/sources/health" && request.method === "GET") return handleSourcesHealthRequest();
  if (pathname === "/api/sources" && request.method === "GET") return handleSourcesRequest(request);
  if (pathname === "/api/subtitles/proxy" && request.method === "GET") return handleSubtitleProxyRequest(request);
  if (pathname === "/api/subtitles" && request.method === "GET") {
    const target = mediaTargetFromUrl(url);
    return target
      ? Response.json({ results: await fetchOpenSubtitles(target, { signal: request.signal }) })
      : Response.json({ error: "Valid media details are required." }, { status: 400 });
  }
  if (pathname === "/api/playback" && request.method === "POST") return createPlayback(request);
  if (pathname === "/api/torrents" && request.method === "POST") {
    try {
      const body = await request.json() as { magnet?: string; fileIndex?: number | null; target?: unknown };
      const target = body.target === undefined ? undefined : mediaTarget(body.target);
      if (body.target !== undefined && !target) {
        return Response.json({ error: "Valid media details are required." }, { status: 400 });
      }
      return await startTorrent(body.magnet ?? "", request.signal, target ?? undefined, body.fileIndex ?? null);
    } catch {
      return Response.json({ error: "Invalid request body." }, { status: 400 });
    }
  }
  const status = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})$/i.exec(pathname);
  if (status && request.method === "GET") return await torrentStatus(status[1]);
  if (status && request.method === "DELETE") return await deleteTorrent(status[1]);
  const diagnostic = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})\/diagnostics$/i.exec(pathname);
  if (diagnostic && request.method === "GET") return await torrentDiagnostics(diagnostic[1]);
  const playback = /^\/api\/playback\/([a-f0-9]{40}|[2-7a-z]{32})$/i.exec(pathname);
  if (playback && request.method === "GET") return await torrentStatus(playback[1]);
  if (playback && request.method === "DELETE") return await deleteTorrent(playback[1]);
  const playbackSubtitles = /^\/api\/playback\/([a-f0-9]{40}|[2-7a-z]{32})\/subtitles$/i.exec(pathname);
  if (playbackSubtitles && request.method === "GET") {
    const response = await torrentStatus(playbackSubtitles[1]);
    if (!response.ok) return response;
    const playbackStatus = await response.json() as { subtitles?: unknown };
    return Response.json(Array.isArray(playbackStatus.subtitles) ? playbackStatus.subtitles : []);
  }
  const subtitle = /^\/api\/torrents\/([a-f0-9]{40}|[2-7a-z]{32})\/subtitles\/(\d+)$/i.exec(pathname);
  if (subtitle && (request.method === "GET" || request.method === "HEAD")) {
    return await streamTorrentSubtitle(request, subtitle[1], subtitle[2]);
  }
  const stream = /^\/api\/stream\/([a-f0-9]{40}|[2-7a-z]{32})\/(\d+)$/i.exec(pathname);
  if (stream && (request.method === "GET" || request.method === "HEAD")) return await streamTorrent(request, stream[1], stream[2]);
  const selectedStream = /^\/api\/stream\/([a-f0-9]{40}|[2-7a-z]{32})$/i.exec(pathname);
  if (selectedStream && (request.method === "GET" || request.method === "HEAD")) {
    try {
      const details = await torrentStatus(selectedStream[1]);
      if (!details.ok) return details;
      const data = await details.json() as { fileIndex?: number | null };
      return typeof data.fileIndex === "number"
        ? streamTorrent(request, selectedStream[1], String(data.fileIndex))
        : Response.json({ error: "Stream not ready." }, { status: 503 });
    } catch {
      return Response.json({ error: "Stream not ready." }, { status: 404 });
    }
  }
  if (pathname.startsWith("/api/")) return Response.json({ error: "Not found." }, { status: 404 });
  return staticResponse(url.pathname);
}

async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedAt = performance.now();
  const requestId = `req-${++requestSequence}`;
  const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${process.env.PORT ?? 9000}`);
  const normalizedPath = normalizePathname(requestUrl.pathname);
  const statusPoll = /^\/api\/(?:torrents|playback)\/([a-f0-9]{40}|[2-7a-z]{32})$/i.test(normalizedPath);
  const mediaStream = /^\/api\/stream\/([a-f0-9]{40}|[2-7a-z]{32})(?:\/\d+)?$/i.test(normalizedPath);
  const staticAsset = /\.[a-z0-9]+$/i.test(requestUrl.pathname);
  const logged = normalizedPath !== "/health" && !statusPoll && !mediaStream && !staticAsset;
  const displayUrl = `${requestUrl.pathname}${requestUrl.search}`;
  let finished = false;
  const finish = (outcome: "complete" | "aborted") => {
    if (!logged || finished) return;
    finished = true;
    accessEnd("api", request.method ?? "GET", displayUrl, response.statusCode, performance.now() - startedAt, requestId, outcome);
  };
  if (logged) {
    response.setHeader("x-request-id", requestId);
    response.once("finish", () => finish("complete"));
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once("aborted", abort);
  response.once("close", () => {
    if (!response.writableEnded) {
      abort();
      finish("aborted");
    }
  });
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
      else if (value !== undefined) headers.set(name, value);
    }
    const incoming = new Request(
      `http://127.0.0.1:${process.env.PORT ?? 9000}${request.url ?? "/"}`,
      { method: request.method, headers, body: await bodyOf(request), signal: controller.signal },
    );
    const outgoing = await handle(incoming);
    response.writeHead(outgoing.status, Object.fromEntries(outgoing.headers));
    if (!outgoing.body || request.method === "HEAD") {
      if (outgoing.body) void outgoing.body.cancel();
      response.end();
      return;
    }
    const stream = Readable.fromWeb(outgoing.body as import("node:stream/web").ReadableStream);
    response.on("close", () => {
      if (!response.writableEnded) stream.destroy();
    });
    stream.on("error", (error) => {
      logLine("api", `event=stream_error request_id=${requestId} error=${JSON.stringify(String(error))}`, "error");
      response.destroy();
    });
    stream.pipe(response);
  } catch (error) {
    logLine("api", `event=http_error request_id=${requestId} error=${JSON.stringify(String(error))}`, "error");
    const status = typeof error === "object" && error && "status" in error ? Number(error.status) || 500 : 500;
    if (!response.headersSent) response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Internal server error." }));
  }
}

const isMain =
  typeof (import.meta as any).main === "boolean"
    ? (import.meta as any).main
    : Boolean(
        process.argv[1] &&
          (process.argv[1].endsWith("/server.ts") ||
            process.argv[1].endsWith("/server.js") ||
            import.meta.url === `file://${process.argv[1]}`)
      );

if (isMain) {
  const port = Number(process.env.PORT ?? 9000);
  const server = createServer((request, response) => {
    void serve(request, response);
  });

  server.listen(port, "127.0.0.1", () => {
    logLine("api", `event=hawk_listening url=http://127.0.0.1:${port}`);
  });
}
