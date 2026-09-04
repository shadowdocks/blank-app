# Hawk

A small mood-first movie picker and torrent streamer deployed through one Streamlit URL.

Streamlit runs this repository as an ASGI application on port 8501. Its Python entrypoint downloads a pinned Node runtime, starts Hawk privately on `127.0.0.1:9000`, and streams every browser request through the public Streamlit server. Video byte ranges pass through unchanged, so seeking and progressive playback work without another public port.

## What is included

- Mood, movie or TV, and duration selection
- Searchable IMDb catalog and shareable title URLs
- TMDB recommendations with IMDb-enriched curated fallback
- Indexed torrent source search and direct magnet input
- React, shadcn, Radix primitives, Tailwind CSS, and tokenized styling
- WebTorrent 3.0.21 with TCP, uTP, parallel DHT discovery, expanded trackers, and 200-peer announces
- HTTP Range video streaming
- History API routes with refresh-safe title, source, and playback state
- Nookwire startup in noninteractive batch mode with authentication disabled

There is no library, history, account system, Plex integration, subtitle manager, or persistent database.

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
