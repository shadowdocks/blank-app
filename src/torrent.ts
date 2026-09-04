const rqbitUrl = process.env.RQBIT_URL ?? "http://127.0.0.1:3030";
const videoPattern = /\.(mp4|m4v|mkv|webm|mov|avi|ts)$/i;
const subtitlePattern = /\.(vtt|srt)$/i;
const selectedFilePattern = String.raw`(?i)\.(mp4|m4v|mkv|webm|mov|avi|ts|vtt|srt)$`;

interface RqbitFile {
  name: string;
  length: number;
  included: boolean;
}

interface RqbitDetails {
  id?: number;
  info_hash: string;
  name?: string;
  files?: RqbitFile[];
}

interface RqbitStats {
  state: "initializing" | "live" | "paused" | "error";
  error?: string | null;
  progress_bytes: number;
  total_bytes: number;
  finished: boolean;
  live?: {
    download_speed?: { mbps?: number };
    snapshot?: {
      peer_stats?: { live?: number };
    };
  } | null;
}

interface ActiveTorrent {
  hash: string;
  startedAt: number;
}

let active: ActiveTorrent | null = null;

function hashFromMagnet(magnet: string): string | null {
  return /xt=urn:btih:([0-9a-f]{40}|[2-7a-z]{32})/i.exec(magnet)?.[1].toLowerCase() ?? null;
}

function largestVideo(files: RqbitFile[]): number | null {
  let selected: { index: number; length: number } | null = null;
  files.forEach((file, index) => {
    if (file.included && videoPattern.test(file.name) && (!selected || file.length > selected.length)) {
      selected = { index, length: file.length };
    }
  });
  return selected?.index ?? null;
}

async function rqbit(path: string, init?: RequestInit, timeout = 10_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const abort = () => controller.abort(init?.signal?.reason);
  if (init?.signal?.aborted) abort();
  else init?.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(`${rqbitUrl}${path}`, { ...init, signal: controller.signal });
  } finally {
    // The timeout guards connection and response headers only. Leaving it armed
    // would abort a healthy movie body after `timeout` milliseconds.
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", abort);
  }
}

async function jsonResponse<T>(path: string, timeout?: number, signal?: AbortSignal): Promise<T> {
  const response = await rqbit(path, { signal }, timeout);
  if (!response.ok) throw Object.assign(new Error(`rqbit returned ${response.status}`), { status: response.status });
  return response.json() as Promise<T>;
}

async function details(hash: string, signal?: AbortSignal): Promise<RqbitDetails> {
  return jsonResponse<RqbitDetails>(`/torrents/${encodeURIComponent(hash)}`, undefined, signal);
}

async function status(hash: string): Promise<RqbitStats> {
  return jsonResponse<RqbitStats>(`/torrents/${encodeURIComponent(hash)}/stats/v1`);
}

function toStatus(info: RqbitDetails, stats: RqbitStats, startedAt: number) {
  const files = info.files ?? [];
  const downloaded = Number(stats.progress_bytes) || 0;
  const length = Number(stats.total_bytes) || files.filter((file) => file.included).reduce((sum, file) => sum + file.length, 0);
  const peers = Number(stats.live?.snapshot?.peer_stats?.live) || 0;
  const speed = (Number(stats.live?.download_speed?.mbps) || 0) * 1024 * 1024;
  const metadata = files.length > 0;
  const lastEvent = stats.error
    ? "error"
    : stats.finished
      ? "complete"
      : !metadata
        ? "resolving_metadata"
        : peers > 0
          ? "peer_connected"
          : "finding_peers";
  return {
    infoHash: info.info_hash,
    name: info.name ?? "Resolving metadata…",
    progress: length > 0 ? downloaded / length : 0,
    downloaded,
    length,
    numPeers: peers,
    downloadSpeed: speed,
    done: Boolean(stats.finished),
    video: largestVideo(files),
    metadata,
    elapsed: Math.round((Date.now() - startedAt) / 1000),
    elapsedMs: Date.now() - startedAt,
    lastEvent,
    error: stats.error ?? null,
    subtitles: files.flatMap((file, index) => subtitlePattern.test(file.name) && file.included
      ? [{ index, name: file.name }]
      : []),
  };
}

async function currentStatus(hash: string) {
  const normalized = hash.toLowerCase();
  const [info, stats] = await Promise.all([details(normalized), status(normalized)]);
  if (!active || active.hash !== normalized) active = { hash: normalized, startedAt: Date.now() };
  return toStatus(info, stats, active.startedAt);
}

async function deleteActive(signal?: AbortSignal): Promise<void> {
  if (!active) return;
  const hash = active.hash;
  const response = await rqbit(`/torrents/${encodeURIComponent(hash)}/delete`, { method: "POST", signal });
  if (!response.ok && response.status !== 404) {
    const message = (await response.text()).trim();
    console.error(`event=torrent_remove_error hash=${hash} status=${response.status}`);
    throw new Error(message || `rqbit could not delete torrent ${hash}`);
  }
  active = null;
}

export async function startTorrent(magnet: string, signal?: AbortSignal): Promise<Response> {
  const hash = hashFromMagnet(magnet);
  if (!hash) return Response.json({ error: "A valid magnet link is required." }, { status: 400 });
  if (active?.hash === hash) {
    try {
      return Response.json(await currentStatus(hash));
    } catch {
      active = null;
    }
  }

  try {
    await deleteActive(signal);
    const query = new URLSearchParams({ only_files_regex: selectedFilePattern });
    const response = await rqbit(`/torrents?${query}`, {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: magnet,
      signal,
    }, 90_000);
    if (!response.ok) {
      const message = (await response.text()).trim();
      return Response.json({ error: message || `rqbit returned ${response.status}.` }, { status: response.status });
    }
    const created = await response.json() as { details: RqbitDetails };
    active = { hash, startedAt: Date.now() };
    console.log(`event=torrent_metadata hash=${hash} files=${created.details.files?.length ?? 0}`);
    return Response.json(await currentStatus(hash), { status: 202 });
  } catch (error) {
    console.error(`event=torrent_error hash=${hash}`, String(error));
    return Response.json({ error: "The torrent engine could not start this magnet." }, { status: 502 });
  }
}

export async function torrentStatus(hash: string): Promise<Response> {
  try {
    return Response.json(await currentStatus(hash));
  } catch (error) {
    const statusCode = typeof error === "object" && error && "status" in error ? Number(error.status) : 502;
    return statusCode === 404
      ? Response.json({ error: "Torrent not found." }, { status: 404 })
      : Response.json({ error: "The torrent engine is unavailable." }, { status: 502 });
  }
}

export async function torrentDiagnostics(hash: string): Promise<Response> {
  try {
    const [torrent, peers] = await Promise.all([
      currentStatus(hash),
      jsonResponse<unknown>(`/torrents/${encodeURIComponent(hash)}/peer_stats`).catch(() => null),
    ]);
    return Response.json({ ...torrent, diagnostics: { engine: "rqbit", runtime: "single-thread", peerLimit: 128, peers } });
  } catch {
    return Response.json({ error: "Torrent not found." }, { status: 404 });
  }
}

function mime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/x-m4v", mkv: "video/x-matroska", webm: "video/webm", mov: "video/quicktime", avi: "video/x-msvideo", ts: "video/mp2t", vtt: "text/vtt", srt: "application/x-subrip" } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

function normalizedRange(value: string | null, length: number): string | null {
  if (!value) return null;
  const suffix = /^bytes=-(\d+)$/.exec(value);
  if (!suffix) return value;
  const size = Number(suffix[1]);
  if (!Number.isSafeInteger(size) || size <= 0) return value;
  return `bytes=${Math.max(0, length - size)}-${length - 1}`;
}

export async function streamTorrent(request: Request, hash: string, index: string): Promise<Response> {
  let info: RqbitDetails;
  try {
    info = await details(hash, request.signal);
  } catch {
    return Response.json({ error: "Stream not ready." }, { status: 404 });
  }
  const fileIndex = Number(index);
  const file = info.files?.[fileIndex];
  if (!file?.included) return Response.json({ error: "Stream not ready." }, { status: 404 });
  const range = normalizedRange(request.headers.get("range"), file.length);
  if (request.method === "HEAD") {
    const match = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
    const start = match ? Number(match[1]) : 0;
    const requestedEnd = match && match[2] ? Number(match[2]) : file.length - 1;
    const end = Math.min(requestedEnd, file.length - 1);
    if (range && (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= file.length || start > requestedEnd)) {
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${file.length}` } });
    }
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-length": String(end - start + 1),
      "content-type": mime(file.name),
    };
    if (range) headers["content-range"] = `bytes ${start}-${end}/${file.length}`;
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const path = `/torrents/${encodeURIComponent(hash)}/stream/${fileIndex}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await rqbit(path, { headers: range ? { range } : undefined, signal: request.signal }, 30_000);
      if (response.status >= 500 && attempt < 4) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
        continue;
      }
      const headers = new Headers(response.headers);
      headers.set("content-type", headers.get("content-type") ?? mime(file.name));
      return new Response(response.body, { status: response.status, headers });
    } catch (error) {
      if (request.signal.aborted) return new Response(null, { status: 499 });
      if (attempt === 4) {
        console.error(`event=stream_error hash=${hash} file=${fileIndex}`, String(error));
        return Response.json({ error: "The stream is temporarily unavailable." }, { status: 503 });
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
  return Response.json({ error: "The stream is temporarily unavailable." }, { status: 503 });
}
