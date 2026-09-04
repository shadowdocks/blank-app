import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const magnet = "magnet:?xt=urn:btih:E3ED889793D8A98B8080ECAFDBF7EDE30AB3889A&dn=Disclosure%20Day%20(2026)%20%5B1080p%5D%20%5BWEBRip%5D%20%5B5.1%5D&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337&tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce&tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce&tr=udp%3A%2F%2Ftracker.bittor.pw%3A1337%2Fannounce&tr=udp%3A%2F%2Fpublic.popcorn-tracker.org%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.dler.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fexodus.desync.com%3A6969&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce&tr=udp%3A%2F%2Fglotorrents.pw%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftorrent.gresille.org%3A80%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337";
const seconds = Math.max(10, Number(process.argv.find((argument) => /^\d+$/.test(argument)) ?? 60));
const transport = process.argv.includes("--tcp") ? "tcp" : "utp";
const sampleEveryMs = 5000;
const downloadDirectory = mkdtempSync(join(tmpdir(), "hawk-torrent-benchmark-"));
process.env.DL_DIR = downloadDirectory;
if (transport === "tcp") process.env.HAWK_UTP = "0";

const torrentModule = await import("../src/torrent.ts");
const started = await torrentModule.startTorrent(magnet).json() as { infoHash: string };
const startedAt = Date.now();
let firstDownloaded = 0;
let lastDownloaded = 0;
let shuttingDown = false;

process.on("uncaughtException", (error: Error & { code?: string }) => {
  if (shuttingDown && /^(UTP_)?(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)$/.test(error.code ?? "")) return;
  throw error;
});

try {
  while (Date.now() - startedAt < seconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, sampleEveryMs));
    const response = torrentModule.torrentDiagnostics(started.infoHash);
    const status = await response.json() as Record<string, any>;
    lastDownloaded = Number(status.downloaded ?? 0);
    console.log(JSON.stringify({
      atSeconds: Math.round((Date.now() - startedAt) / 1000),
      transport,
      downloaded: status.downloaded,
      downloadSpeed: status.downloadSpeed,
      peers: status.diagnostics?.peers,
      engine: status.diagnostics?.engine,
      process: status.diagnostics?.process,
    }));
  }
  const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  console.log(JSON.stringify({
    result: "complete",
    transport,
    elapsedSeconds: Number(elapsedSeconds.toFixed(1)),
    downloadedBytes: lastDownloaded,
    averageBytesPerSecond: Math.round(lastDownloaded / elapsedSeconds),
  }));
} finally {
  shuttingDown = true;
  await Promise.race([
    torrentModule.closeTorrentClient(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  rmSync(downloadDirectory, { recursive: true, force: true });
  setTimeout(() => process.exit(0), 100);
}
