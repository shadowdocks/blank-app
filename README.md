# Hawk

Hawk is an IMDb-first movie and TV browser with torrent playback, subtitles, a local library, and offline downloads. It is a relative, installable PWA that works at a root domain, below Streamlit's `/~/+/` mount, or below another path without rebuilding.

## Architecture

- **Cloudflare Worker:** Serves the catalog API from focused IMDb GraphQL queries, adds TMDB data only when IMDb fields are missing, caches public metadata at the edge, and proxies the app to one or more configured origins.
- **React PWA:** Uses Radix primitives, shadcn components, Tailwind, and Vidstack. Routes, assets, API calls, manifest scope, and service-worker scope are mount-relative.
- **Node backend:** Searches Torrentio and APiBay concurrently, ranks and deduplicates sources, manages a bounded rqbit torrent pool, selects exact movie or episode files, converts subtitles to WebVTT, and streams byte ranges.
- **Streamlit supervisor:** Installs checksum-pinned runtimes, starts rqbit and Node privately, and exposes the app through one Streamlit port.

The app has no accounts, database, analytics, ads, browser scraping, or remote personal-data sync. Bookmarks, history, preferences, progress, and download metadata remain in the browser.

## Product surface

- IMDb popularity rails, search, discovery, details, ratings, cast, trailers, similar titles, seasons, and episodes
- Automatic best-source playback with manual source switching
- Concurrent torrents with bounded idle cleanup instead of one global torrent
- Torrent sidecar and OpenSubtitles tracks available from the first playback
- Installable phone PWA with a precached shell and explicit update flow
- Resumable offline video downloads using OPFS with IndexedDB fallback
- Local byte-range playback, artwork, and subtitles while offline
- Responsive, keyboard-accessible Hawk design with reduced-motion support

Offline mode covers the installed shell and media downloaded in advance. New catalog requests, source searches, and torrent starts still require a network. Mobile operating systems may pause downloads when the browser is backgrounded and may reclaim storage under pressure.

## Local development

Requires Python 3.14, `uv`, Bun 1.4, Node 22, and a Cloudflare token that can use Browser Rendering.

```sh
uv sync
bun install --frozen-lockfile
npm --prefix cloudflare ci
bun run dev
```

`bun run dev` starts rqbit on port 3030, Node on 9000, local Wrangler on 8787, and Vite on 5173. Vite sends catalog requests to Wrangler and streaming requests to Node. Browser Rendering stays remote through its Wrangler binding.

Focused commands:

```sh
bun run dev:frontend
bun run dev:edge
bun run typecheck
bun test
bun run build
bun run edge:check
```

Provider endpoints can be replaced without code changes through `TORRENTIO_URL`, `APIBAY_URL`, and `OPENSUBTITLES_URL`. rqbit uses `RQBIT_URL`. Torrent capacity and idle cleanup use `HAWK_TORRENT_POOL_MAX` and `HAWK_TORRENT_POOL_TTL_MINUTES`.

## Cloudflare configuration

`cloudflare/wrangler.jsonc` owns the public hostname, Browser Rendering binding, WAF token Durable Object, rate limiter, cache policy, and upstream routing. `UPSTREAM_ORIGINS` accepts a comma-separated list. Stateless requests retry healthy candidates; torrent requests use deterministic info-hash affinity so every range request reaches the origin holding that torrent.

TMDB is optional and only fills metadata gaps:

```sh
wrangler-alt secret put TMDB_API_KEY --config cloudflare/wrangler.jsonc
```

The Worker keeps catalog objects public-cacheable. Personal state, playback status, stream responses, and offline files are never shared-cached. Hashed build assets are immutable; HTML, the manifest, and the service worker always revalidate.

## Deployment

Deploy the Worker first so catalog routes exist, then push the app to `main` to trigger Streamlit's rebuild. The previous standalone IMDb Worker should remain untouched as rollback until the combined Hawk Worker is verified.

Streamlit operational commands remain available through `bun run cloud`. Mutating commands and all Worker deployments require explicit approval.
