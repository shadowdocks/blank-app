const TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://exodus.desync.com:6969/announce",
].map((tracker) => `&tr=${encodeURIComponent(tracker)}`).join("");

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export async function sources(url: URL): Promise<Response> {
  const title = url.searchParams.get("title")?.trim();
  if (!title) return Response.json({ error: "A title is required." }, { status: 400 });
  try {
    const response = await fetch(`https://apibay.org/q.php?q=${encodeURIComponent(title)}&cat=200`, {
      headers: { "User-Agent": "hawk/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Source search returned ${response.status}`);
    const rows = await response.json() as any[];
    const results = (Array.isArray(rows) ? rows : [])
      .filter((row) => row.id !== "0" && /^[a-f0-9]{40}$/i.test(row.info_hash))
      .map((row) => ({
        name: row.name,
        seeds: Number.parseInt(row.seeders, 10) || 0,
        leeches: Number.parseInt(row.leechers, 10) || 0,
        size: formatBytes(Number.parseInt(row.size, 10)),
        source: "tpb",
        hash: row.info_hash.toUpperCase(),
        magnet: `magnet:?xt=urn:btih:${row.info_hash.toUpperCase()}&dn=${encodeURIComponent(row.name)}${TRACKERS}`,
      }))
      .sort((a, b) => b.seeds - a.seeds)
      .slice(0, 12);
    if (!results.length) return Response.json({ error: "No streams found." }, { status: 404 });
    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Source search failed." }, { status: 502 });
  }
}
