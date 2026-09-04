import { Readable } from "node:stream";
import WebTorrent from "webtorrent";

const directory = process.env.DL_DIR ?? "/tmp/hawk-downloads";
const liveTrackers = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://tracker.bittor.pw:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://tracker-udp.gbitt.info:80/announce",
  "udp://opentracker.io:6969/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "https://tracker.tamersunion.org:443/announce",
];
const client = new WebTorrent({ maxConns: 200, dht: { concurrency: 64 }, utp: true });
const videoPattern = /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i;
const startedAt = new WeakMap<object, number>();
const lastEvent = new WeakMap<object, string>();
const torrentsByHash = new Map<string, any>();

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
    metadata: files.length > 0,
    elapsed: Math.round((Date.now() - (startedAt.get(torrent) ?? Date.now())) / 1000),
    elapsedMs: Date.now() - (startedAt.get(torrent) ?? Date.now()),
    lastEvent: lastEvent.get(torrent) ?? "connecting",
  };
}

function findTorrent(hash: string): any | undefined {
  const target = hash.toLowerCase();
  return torrentsByHash.get(target) ?? client.torrents.find((torrent) => torrent.infoHash === target);
}

export function startTorrent(magnet: string): Response {
  const hash = hashFromMagnet(magnet);
  if (!hash) return Response.json({ error: "A valid magnet link is required." }, { status: 400 });
  const existing = findTorrent(hash);
  if (existing) return Response.json(json(existing, hash));
  for (const active of [...client.torrents]) {
    for (const [activeHash, tracked] of torrentsByHash) {
      if (tracked === active) torrentsByHash.delete(activeHash);
    }
    client.remove(active, { destroyStore: true }, (error?: Error) => {
      if (error) console.error(`event=torrent_remove_error hash=${active.infoHash}`, String(error));
    });
  }
  const torrent = client.add(magnet, {
    path: directory,
    announce: liveTrackers,
    storeCacheSlots: 64,
    getAnnounceOpts: () => ({ numwant: 200 }),
  } as any);
  torrentsByHash.set(hash, torrent);
  startedAt.set(torrent, Date.now());
  lastEvent.set(torrent, "resolving_metadata");
  torrent.once("infoHash", () => {
    lastEvent.set(torrent, "finding_peers");
    console.log(`event=torrent_info_hash hash=${hash}`);
  });
  torrent.once("metadata", () => {
    lastEvent.set(torrent, "metadata_ready");
    console.log(`event=torrent_metadata hash=${hash} files=${torrent.files.length}`);
    // Keep the selected movie downloading at low priority to saturate available
    // peers. Range streams use WebTorrent's higher stream priority for playback.
    torrent.deselect(0, torrent.pieces.length - 1);
    videoFile(torrent.files)?.select(0);
  });
  torrent.once("wire", () => {
    lastEvent.set(torrent, "peer_connected");
    console.log(`event=torrent_peer hash=${hash} peers=${torrent.numPeers}`);
  });
  torrent.once("done", () => {
    lastEvent.set(torrent, "complete");
    console.log(`event=torrent_done hash=${hash}`);
  });
  torrent.on("warning", (warning: unknown) => {
    const message = String(warning);
    if (!/fetch failed|ENOTFOUND|timed out|announce|ECONN/i.test(message)) {
      console.warn(`event=torrent_warning hash=${hash}`, message);
    }
  });
  torrent.once("error", (error: unknown) => {
    lastEvent.set(torrent, "error");
    console.error(`event=torrent_error hash=${hash}`, String(error));
  });
  return Response.json(json(torrent, hash), { status: 202 });
}

export function torrentStatus(hash: string): Response {
  const torrent = findTorrent(hash);
  return torrent
    ? Response.json(json(torrent))
    : Response.json({ error: "Torrent not found." }, { status: 404 });
}

function mime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/x-m4v", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", ts: "video/mp2t" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

export function streamTorrent(request: Request, hash: string, index: string): Response {
  const torrent = findTorrent(hash);
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
  const body = request.method === "HEAD"
    ? null
    : Readable.toWeb(file.createReadStream({ start, end }), {
      strategy: new ByteLengthQueuingStrategy({ highWaterMark: 64 * 1024 }),
    }) as ReadableStream;
  return new Response(body, { status: range ? 206 : 200, headers });
}
