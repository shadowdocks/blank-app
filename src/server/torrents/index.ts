import { logLine } from "../../access-log";
import type { MediaTarget, PlaybackStatus, SubtitleTrack } from "../../shared/playback";
import { ensureWebVtt } from "../subtitles/converter";
import { fetchOpenSubtitles } from "../subtitles/adapter";
import { normalizeTracks } from "../subtitles";
import { defaultRqbitClient } from "./client";
import { TorrentPool, defaultTorrentPool, hashFromMagnet } from "./pool";
import {
  mime,
  normalizedRange,
  parseByteRange,
  selectPlayableFile,
  selectSidecarSubtitles,
  VIDEO_PATTERN,
} from "./selection";
import type { RqbitDetails, TorrentDiagnosticData } from "./types";

export * from "./types";
export * from "./client";
export * from "./selection";
export * from "./pool";

const lastStatusLogAt = new Map<string, number>();
const externalSubtitles = new Map<string, SubtitleTrack[]>();

export function getTorrentPool(): TorrentPool {
  return defaultTorrentPool;
}

export async function getDetailedStatus(
  hash: string,
  pool = defaultTorrentPool,
  client = defaultRqbitClient,
  target?: MediaTarget,
): Promise<PlaybackStatus> {
  const normalized = hash.toLowerCase();
  const [info, stats] = await Promise.all([
    client.getDetails(normalized),
    client.getStats(normalized),
  ]);

  const poolEntry = pool.get(normalized);
  const effectiveTarget = target ?? poolEntry?.target;

  const files = info.files ?? [];
  const downloaded = Number(stats.progress_bytes) || 0;
  const length =
    Number(stats.total_bytes) ||
    files.filter((f) => f.included).reduce((sum, f) => sum + f.length, 0);
  const peers = Number(stats.live?.snapshot?.peer_stats?.live) || 0;
  const speed = (Number(stats.live?.download_speed?.mbps) || 0) * 1024 * 1024;
  const metadata = files.length > 0;

  const preferredIndex = poolEntry?.preferredFileIndex ?? null;
  const preferredFile = preferredIndex === null ? null : files[preferredIndex];
  const playableVideo = preferredFile?.included && VIDEO_PATTERN.test(preferredFile.name)
    ? preferredIndex
    : selectPlayableFile(
      files,
      effectiveTarget?.mediaType,
      effectiveTarget?.season,
      effectiveTarget?.episode,
    );

  const subtitles = normalizeTracks(
    selectSidecarSubtitles(files, info.info_hash),
    externalSubtitles.get(normalized) ?? [],
  );
  const state: PlaybackStatus["state"] = stats.error
    ? "error"
    : stats.finished
      ? "complete"
      : !metadata
        ? "resolving"
        : playableVideo === null
          ? "connecting"
          : peers > 0
            ? "ready"
            : "downloading";

  return {
    id: info.info_hash,
    infoHash: info.info_hash,
    name: info.name ?? "Resolving metadata…",
    fileIndex: playableVideo,
    streamUrl: playableVideo === null ? null : `/api/stream/${info.info_hash}/${playableVideo}`,
    progress: length > 0 ? downloaded / length : 0,
    downloadedBytes: downloaded,
    totalBytes: length,
    peers,
    downloadSpeed: speed,
    ready: playableVideo !== null,
    complete: Boolean(stats.finished),
    state,
    error: stats.error ?? null,
    subtitles,
  };
}

export async function startTorrent(
  magnet: string,
  signal?: AbortSignal,
  target?: MediaTarget,
  preferredFileIndex: number | null = null,
  pool = defaultTorrentPool,
  client = defaultRqbitClient,
): Promise<Response> {
  const hash = hashFromMagnet(magnet);
  if (!hash) {
    return Response.json({ error: "A valid magnet link is required." }, { status: 400 });
  }

  try {
    const isReused = pool.has(hash);
    await pool.getOrCreate(magnet, target, signal, preferredFileIndex);
    if (target && !externalSubtitles.has(hash)) {
      externalSubtitles.set(hash, []);
      void fetchOpenSubtitles(target).then((tracks) => {
        externalSubtitles.set(hash, tracks);
      });
    }
    const statusData = await getDetailedStatus(hash, pool, client, target);
    return Response.json(statusData, { status: isReused ? 200 : 202 });
  } catch (error: unknown) {
    if (signal?.aborted) {
      logLine("rqbit", `event=torrent_cancelled hash=${hash}`, "warn");
      return new Response(null, { status: 499 });
    }
    logLine("rqbit", `event=torrent_error hash=${hash} error=${JSON.stringify(String(error))}`, "error");
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status) || 502
        : 502;
    const message = error instanceof Error ? error.message : "The torrent engine could not start this magnet.";
    return Response.json({ error: message }, { status });
  }
}

export async function torrentStatus(
  hash: string,
  target?: MediaTarget,
  pool = defaultTorrentPool,
  client = defaultRqbitClient,
): Promise<Response> {
  try {
    const torrent = await getDetailedStatus(hash, pool, client, target);
    const now = Date.now();
    if (now - (lastStatusLogAt.get(hash) ?? 0) >= 10_000 || torrent.complete) {
      lastStatusLogAt.set(hash, now);
      logLine(
        "rqbit",
        `event=torrent_status hash=${torrent.infoHash} state=${torrent.state} ` +
          `progress=${(torrent.progress * 100).toFixed(1)} downloaded=${torrent.downloadedBytes} ` +
          `total=${torrent.totalBytes} peers=${torrent.peers} speed_bps=${Math.round(torrent.downloadSpeed)}`,
      );
    }
    return Response.json(torrent);
  } catch (error: unknown) {
    const statusCode =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 502;
    return statusCode === 404
      ? Response.json({ error: "Torrent not found." }, { status: 404 })
      : Response.json({ error: "The torrent engine is unavailable." }, { status: 502 });
  }
}

export async function torrentDiagnostics(
  hash: string,
  pool = defaultTorrentPool,
  client = defaultRqbitClient,
): Promise<Response> {
  try {
    const normalized = hash.toLowerCase();
    const [torrent, peers] = await Promise.all([
      getDetailedStatus(normalized, pool, client),
      client.getPeerStats(normalized),
    ]);

    const poolEntry = pool.get(normalized);
    const diagnostics: TorrentDiagnosticData = {
      engine: "rqbit",
      runtime: "multi-pool",
      peerLimit: 128,
      poolSize: pool.size,
      maxPoolSize: pool.config.maxTorrents,
      activeStreams: poolEntry?.activeStreams ?? 0,
      peers,
    };

    return Response.json({ ...torrent, diagnostics });
  } catch {
    return Response.json({ error: "Torrent not found." }, { status: 404 });
  }
}

export async function deleteTorrent(
  hash: string,
  pool = defaultTorrentPool,
): Promise<Response> {
  try {
    const success = await pool.delete(hash);
    externalSubtitles.delete(hash.toLowerCase());
    lastStatusLogAt.delete(hash.toLowerCase());
    return Response.json({ success, hash: hash.toLowerCase() });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete torrent";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function streamTorrentSubtitle(
  request: Request,
  hash: string,
  index: string,
  client = defaultRqbitClient,
): Promise<Response> {
  const normalized = hash.toLowerCase();
  const fileIndex = Number(index);
  try {
    const details = await client.getDetails(normalized, request.signal);
    const file = details.files?.[fileIndex];
    if (!file?.included || !/\.(vtt|srt|ass)$/i.test(file.name) || file.length > 5 * 1024 * 1024) {
      return Response.json({ error: "Subtitle not found." }, { status: 404 });
    }
    const upstream = await client.streamFile(normalized, fileIndex, null, request.signal);
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return Response.json({ error: "Subtitle is not ready." }, { status: 503 });
    }
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return Response.json({ error: "Subtitle is too large." }, { status: 413 });
    }
    const extension = file.name.split(".").pop()?.toLowerCase();
    const format = extension === "ass" ? "ass" : extension === "vtt" ? "vtt" : "srt";
    const vtt = ensureWebVtt(new TextDecoder().decode(bytes), format);
    return new Response(request.method === "HEAD" ? null : vtt, {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(Buffer.byteLength(vtt)),
        "content-type": "text/vtt; charset=utf-8",
      },
    });
  } catch {
    return Response.json({ error: "Subtitle is not ready." }, { status: 503 });
  }
}

export async function streamTorrent(
  request: Request,
  hash: string,
  index: string,
  pool = defaultTorrentPool,
  client = defaultRqbitClient,
): Promise<Response> {
  const normalized = hash.toLowerCase();
  let info: RqbitDetails;

  try {
    info = await client.getDetails(normalized, request.signal);
  } catch {
    return Response.json({ error: "Stream not ready." }, { status: 404 });
  }

  const fileIndex = Number(index);
  const file = info.files?.[fileIndex];
  if (!file || !file.included) {
    return Response.json({ error: "Stream not ready." }, { status: 404 });
  }

  const range = normalizedRange(request.headers.get("range"), file.length);

  if (request.method === "HEAD") {
    if (range) {
      const parsed = parseByteRange(range, file.length);
      if (!parsed || !parsed.isValid) {
        return new Response(null, {
          status: 416,
          headers: { "content-range": `bytes */${file.length}` },
        });
      }

      return new Response(null, {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(parsed.end - parsed.start + 1),
          "content-range": `bytes ${parsed.start}-${parsed.end}/${file.length}`,
          "content-type": mime(file.name),
        },
      });
    }

    return new Response(null, {
      status: 200,
      headers: {
        "accept-ranges": "bytes",
        "content-length": String(file.length),
        "content-type": mime(file.name),
      },
    });
  }

  // GET request: mark streaming active in pool
  pool.touchStream(normalized, 1);
  let streamClosed = false;
  const onStreamClose = () => {
    if (!streamClosed) {
      streamClosed = true;
      pool.touchStream(normalized, -1);
    }
  };

  try {
    const upstream = await client.streamFile(normalized, fileIndex, range, request.signal);
    const headers = new Headers(upstream.headers);
    headers.set("content-type", headers.get("content-type") ?? mime(file.name));

    if (!upstream.body) {
      onStreamClose();
      return new Response(null, { status: upstream.status, headers });
    }

    // Wrap readable stream to monitor when it closes or aborts
    const reader = upstream.body.getReader();
    const wrappedStream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            onStreamClose();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (err) {
          onStreamClose();
          controller.error(err);
        }
      },
      cancel(reason) {
        onStreamClose();
        return reader.cancel(reason);
      },
    });

    return new Response(wrappedStream, {
      status: upstream.status,
      headers,
    });
  } catch (error: unknown) {
    onStreamClose();
    if (request.signal?.aborted) {
      return new Response(null, { status: 499 });
    }
    logLine("rqbit", `event=stream_dispatch_error hash=${normalized} file=${fileIndex} error=${JSON.stringify(String(error))}`, "error");
    return Response.json({ error: "The stream is temporarily unavailable." }, { status: 503 });
  }
}
