import { Readable } from "node:stream";
import WebTorrent from "webtorrent";

const directory = process.env.DL_DIR ?? "/tmp/hawk-downloads";
const client = new WebTorrent({ maxConns: 150, dht: { concurrency: 48 }, utp: true });
const videoPattern = /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i;

client.on("error", (error: unknown) => console.error("event=torrent_client_error", String(error)));

function hashFromMagnet(magnet: string): string | null {
  return /xt=urn:btih:([0-9a-f]{40}|[2-7a-z]{32})/i.exec(magnet)?.[1].toLowerCase() ?? null;
}

function videoFile(files: any[]): any | null {
  const videos = files.filter((file) => videoPattern.test(file.name));
  return [...(videos.length ? videos : files)].sort((a, b) => b.length - a.length)[0] ?? null;
}

function json(torrent: any, fallbackHash?: string) {
  const files = torrent.files ?? [];
  const video = videoFile(files);
  return {
    infoHash: torrent.infoHash ?? fallbackHash,
    name: torrent.name ?? "Resolving metadata…",
    progress: torrent.progress ?? 0,
    downloaded: torrent.downloaded ?? 0,
    length: torrent.length ?? 0,
    numPeers: torrent.numPeers ?? 0,
    downloadSpeed: torrent.downloadSpeed ?? 0,
    done: torrent.done ?? false,
    video: video ? files.indexOf(video) : null,
  };
}

export function startTorrent(magnet: string): Response {
  const hash = hashFromMagnet(magnet);
  if (!hash) return Response.json({ error: "A valid magnet link is required." }, { status: 400 });
  const existing = (client.get(magnet) ?? client.get(hash) ?? client.torrents.find((torrent) => torrent.infoHash === hash)) as any;
  if (existing) return Response.json(json(existing, hash));
  for (const active of [...client.torrents]) {
    client.remove(active, { destroyStore: true }, (error?: Error) => {
      if (error) console.error(`event=torrent_remove_error hash=${active.infoHash}`, String(error));
    });
  }
  const torrent = client.add(magnet, { path: directory });
  torrent.once("metadata", () => {
    console.log(`event=torrent_metadata hash=${hash} files=${torrent.files.length}`);
    torrent.deselect(0, torrent.pieces.length - 1, false);
  });
  torrent.once("done", () => console.log(`event=torrent_done hash=${hash}`));
  torrent.on("warning", (warning: unknown) => {
    const message = String(warning);
    if (!/fetch failed|ENOTFOUND|timed out|announce|ECONN/i.test(message)) {
      console.warn(`event=torrent_warning hash=${hash}`, message);
    }
  });
  torrent.once("error", (error: unknown) => console.error(`event=torrent_error hash=${hash}`, String(error)));
  return Response.json(json(torrent, hash), { status: 202 });
}

export function torrentStatus(hash: string): Response {
  const target = hash.toLowerCase();
  const torrent = (client.get(target) ?? client.torrents.find((item) => item.infoHash === target)) as any;
  return torrent
    ? Response.json(json(torrent))
    : Response.json({ error: "Torrent not found." }, { status: 404 });
}

function mime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/x-m4v", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", ts: "video/mp2t" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export function streamTorrent(request: Request, hash: string, index: string): Response {
  const target = hash.toLowerCase();
  const torrent = (client.get(target) ?? client.torrents.find((item) => item.infoHash === target)) as any;
  const file = torrent?.files?.[Number(index)];
  if (!file) return Response.json({ error: "Stream not ready." }, { status: 404 });

  const range = request.headers.get("range");
  let start = 0;
  let end = file.length - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2])) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
    }
    if (match[1] && match[2]) {
      start = Number(match[1]);
      end = Math.min(Number(match[2]), file.length - 1);
    } else if (match[1]) {
      start = Number(match[1]);
      end = file.length - 1;
    } else {
      const suffix = Number(match[2]);
      if (suffix <= 0) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
      }
      start = Math.max(0, file.length - suffix);
      end = file.length - 1;
    }
    if (start > end || start >= file.length) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
    }
  }

  const headers: Record<string, string> = {
    "accept-ranges": "bytes",
    "content-length": String(end - start + 1),
    "content-type": mime(file.name),
  };
  if (range) headers["content-range"] = `bytes ${start}-${end}/${file.length}`;
  const body = Readable.toWeb(file.createReadStream({ start, end })) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers });
}
