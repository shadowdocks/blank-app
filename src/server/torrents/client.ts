import { logLine } from "../../access-log";
import { SELECTED_FILE_PATTERN } from "./selection";
import type { RqbitDetails, RqbitStats } from "./types";

export class RqbitClient {
  private baseUrl: string;
  private addTimeoutMs: number;

  constructor(baseUrl?: string, addTimeoutMs?: number) {
    this.baseUrl = (baseUrl ?? process.env.RQBIT_URL ?? "http://127.0.0.1:3030").replace(/\/+$/, "");
    const configuredTimeout = Number.parseInt(process.env.RQBIT_ADD_TIMEOUT_MS ?? "", 10);
    this.addTimeoutMs = addTimeoutMs ?? (Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15_000);
  }

  private async request(
    path: string,
    init?: RequestInit,
    timeoutMs = 10_000,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abort = () => controller.abort(init?.signal?.reason);

    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener("abort", abort, { once: true });

    try {
      try {
        return await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
        });
      } catch (error) {
        if (timedOut) {
          throw Object.assign(new Error(`rqbit request timed out after ${timeoutMs}ms`), { status: 504 });
        }
        throw error;
      }
    } finally {
      // Timeout guards connection and response headers only
      clearTimeout(timer);
      init?.signal?.removeEventListener("abort", abort);
    }
  }

  private async json<T>(path: string, timeoutMs = 10_000, signal?: AbortSignal): Promise<T> {
    const response = await this.request(path, { signal }, timeoutMs);
    if (!response.ok) {
      throw Object.assign(new Error(`rqbit returned HTTP ${response.status}`), {
        status: response.status,
      });
    }
    return response.json() as Promise<T>;
  }

  async addTorrent(magnet: string, signal?: AbortSignal): Promise<RqbitDetails> {
    const query = new URLSearchParams({ only_files_regex: SELECTED_FILE_PATTERN });
    const response = await this.request(
      `/torrents?${query}`,
      {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: magnet,
        signal,
      },
      this.addTimeoutMs,
    );

    if (!response.ok) {
      const message = (await response.text()).trim();
      throw Object.assign(new Error(message || `rqbit returned ${response.status}`), {
        status: response.status,
      });
    }

    const created = (await response.json()) as { details: RqbitDetails } | RqbitDetails;
    return "details" in created ? created.details : created;
  }

  async getDetails(hash: string, signal?: AbortSignal): Promise<RqbitDetails> {
    return this.json<RqbitDetails>(`/torrents/${encodeURIComponent(hash.toLowerCase())}`, 10_000, signal);
  }

  async getStats(hash: string, signal?: AbortSignal): Promise<RqbitStats> {
    return this.json<RqbitStats>(`/torrents/${encodeURIComponent(hash.toLowerCase())}/stats/v1`, 10_000, signal);
  }

  async getPeerStats(hash: string, signal?: AbortSignal): Promise<unknown> {
    return this.json<unknown>(`/torrents/${encodeURIComponent(hash.toLowerCase())}/peer_stats`, 10_000, signal).catch(
      () => null,
    );
  }

  async deleteTorrent(hash: string, signal?: AbortSignal): Promise<boolean> {
    const normalized = hash.toLowerCase();
    try {
      const response = await this.request(`/torrents/${encodeURIComponent(normalized)}/delete`, {
        method: "POST",
        signal,
      });

      if (!response.ok && response.status !== 404) {
        const message = (await response.text()).trim();
        logLine("rqbit", `event=torrent_remove_error hash=${normalized} status=${response.status}`, "error");
        throw new Error(message || `rqbit could not delete torrent ${normalized}`);
      }

      logLine("rqbit", `event=torrent_removed hash=${normalized}`);
      return true;
    } catch (err: unknown) {
      if (typeof err === "object" && err && "status" in err && (err as { status: number }).status === 404) {
        return true;
      }
      throw err;
    }
  }

  async streamFile(
    hash: string,
    fileIndex: number,
    range?: string | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    const path = `/torrents/${encodeURIComponent(hash.toLowerCase())}/stream/${fileIndex}`;
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) {
        return new Response(null, { status: 499 });
      }

      try {
        const response = await this.request(
          path,
          {
            headers: range ? { range } : undefined,
            signal,
          },
          30_000,
        );

        // Only retry transient 5xx server errors
        if (response.status >= 500 && attempt < maxAttempts) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, attempt * 250));
          continue;
        }

        return response;
      } catch (error: unknown) {
        if (signal?.aborted) {
          return new Response(null, { status: 499 });
        }

        // Only retry on network errors if attempts remain
        if (attempt === maxAttempts) {
          logLine(
            "rqbit",
            `event=stream_error hash=${hash} file=${fileIndex} attempt=${attempt} error=${JSON.stringify(String(error))}`,
            "error",
          );
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }

    throw new Error("The stream is temporarily unavailable.");
  }
}

export const defaultRqbitClient = new RqbitClient();
