# Hawk

A small mood-first movie picker and torrent streamer deployed through one Streamlit URL.

Streamlit runs this repository as an ASGI application on port 8501. Its Python entrypoint downloads a pinned Node runtime, starts Hawk privately on `127.0.0.1:9000`, and streams every browser request through the public Streamlit server. Video byte ranges pass through unchanged, so seeking and progressive playback work without another public port.

## What is included

- Mood, movie or TV, and duration selection
- Searchable IMDb catalog and shareable title URLs
- TMDB recommendations with IMDb-enriched curated fallback
- Indexed torrent source search and direct magnet input
- React, shadcn, Radix primitives, Tailwind CSS, and tokenized styling
- Lazy-loaded Vidstack player with responsive controls and selectable SRT/WebVTT subtitles
- Checksum-pinned rqbit 9.0.1 with TCP, DHT, expanded trackers, and a 128-peer ceiling
- Native seek-aware HTTP Range video streaming with selected subtitle files
- History API routes with refresh-safe title, source, and playback state
- Nookwire startup in noninteractive batch mode with authentication disabled

There is no library, history, account system, Plex integration, or persistent database.

## Configuration

Add an optional TMDB key to the Streamlit app settings:

```toml
TMDB_API_KEY = "your-key"
```

Without it, Hawk uses the bundled recommendations. The app and SSH endpoint do not require authentication, so deploy it only with the visibility you intend.

Nookwire derives a stable endpoint identity from this repository and the runtime user. Replacement Streamlit containers therefore keep the same SSH hostname without a configured seed.

## Local development

Requires Python 3.14, `uv`, Bun 1.4, and Node 22.

```sh
uv sync
bun install --frozen-lockfile
uv run streamlit run streamlit_app.py
```

The launcher uses its pinned Node runtime in production. To run only the internal Hawk server while editing the frontend:

```sh
bun run dev
```

Hawk runs rqbit with its single-thread Tokio scheduler, TCP peers, and a 128-peer ceiling.
On Streamlit Community Cloud, the same 2.88 GB torrent
streamed at about 86 MB/s while rqbit used about 64% of one CPU and 27 MB RSS. The launcher
downloads the official rqbit binary and verifies its release checksum before execution.

## Streamlit Cloud operations

Copy `.streamlit-cloud.example.json` to `.streamlit-cloud.json` and fill it with the authenticated values from a browser request. The local config is ignored by Git.

```sh
bun run cloud status
bun run cloud context
bun run cloud logs 30
bun run cloud reboot 240
bun run cloud secrets
bun run cloud secrets-set .streamlit/secrets.toml
```

A push to `main` is the normal deployment path. Hawk's running supervisor detects the new Git revision, rebuilds the frontend, and replaces the Node/rqbit runtime. No Cloud command is needed.

`reboot` is an explicit Streamlit process reboot, not a deployment command. Use it only when `streamlit_app.py` or its Python dependencies changed, because the already-running Python interpreter cannot load new launcher code from a Git pull. It waits for Streamlit to report RUNNING and then verifies `/healthz`. Bun only runs this local helper; it is not the deployment mechanism. Mutating commands require a current CSRF token and session cookie.
