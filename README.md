# Hawk

A small mood-first movie picker and torrent streamer deployed through one Streamlit URL.

Streamlit runs this repository as an ASGI application on port 8501. Its Python entrypoint downloads a pinned Node runtime, starts Hawk privately on `127.0.0.1:9000`, and streams every browser request through the public Streamlit server. Video byte ranges pass through unchanged, so seeking and progressive playback work without another public port.

## What is included

- Mood, movie or TV, and duration selection
- TMDB recommendations with a curated offline fallback
- Torrent source search
- WebTorrent 2.8.5 with TCP, uTP, DHT, and tracker peer discovery
- HTTP Range video streaming
- Nookwire SSH startup with authentication disabled

There is no library, history, account system, Plex integration, subtitle manager, or persistent database.

## Configuration

Add an optional TMDB key to the Streamlit app settings:

```toml
TMDB_API_KEY = "your-key"
```

Without it, Hawk uses the bundled recommendations. The app and SSH endpoint do not require authentication, so deploy it only with the visibility you intend.

## Local development

Requires Python 3.14, `uv`, and Node 22.

```sh
uv sync
npm ci
uv run streamlit run streamlit_app.py
```

The launcher uses its pinned Node runtime in production. To run only the internal Hawk server while editing the frontend:

```sh
npm start
```
