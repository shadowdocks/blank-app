import type { ProviderHealth } from "./types";
export type { ProviderHealthStatus } from "./types";

export async function probeTorrentio(timeoutMs = 5000): Promise<ProviderHealth> {
  const baseUrl = (process.env.TORRENTIO_URL ?? "https://torrentio.strem.fun").replace(/\/+$/, "");
  // Using a canonical IMDb ID for health probing
  const endpoint = `${baseUrl}/stream/movie/tt0111161.json`;
  const start = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "hawk/2.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - start);

    if (!response.ok) {
      return {
        provider: "torrentio",
        status: "http_error",
        statusCode: response.status,
        durationMs,
        error: `HTTP ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        provider: "torrentio",
        status: "invalid_shape",
        statusCode: response.status,
        durationMs,
        error: "Response body is not valid JSON",
      };
    }

    if (!body || typeof body !== "object" || !Array.isArray((body as { streams?: unknown }).streams)) {
      return {
        provider: "torrentio",
        status: "invalid_shape",
        statusCode: response.status,
        durationMs,
        error: "Missing or invalid streams field",
      };
    }

    return {
      provider: "torrentio",
      status: "ok",
      statusCode: response.status,
      durationMs,
      error: null,
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const isTimeout =
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
      controller.signal.aborted;

    return {
      provider: "torrentio",
      status: isTimeout ? "timeout" : "http_error",
      statusCode: null,
      durationMs,
      error: isTimeout ? `Timed out after ${timeoutMs}ms` : err instanceof Error ? err.message : "Connection failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeApiBay(timeoutMs = 5000): Promise<ProviderHealth> {
  const baseUrl = (process.env.APIBAY_URL ?? "https://apibay.org").replace(/\/+$/, "");
  const endpoint = `${baseUrl}/q.php?q=test&cat=200`;
  const start = performance.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      headers: {
        "User-Agent": "hawk/2.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    const durationMs = Math.round(performance.now() - start);

    if (!response.ok) {
      return {
        provider: "apibay",
        status: "http_error",
        statusCode: response.status,
        durationMs,
        error: `HTTP ${response.status}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        provider: "apibay",
        status: "invalid_shape",
        statusCode: response.status,
        durationMs,
        error: "Response body is not valid JSON",
      };
    }

    if (!Array.isArray(body)) {
      return {
        provider: "apibay",
        status: "invalid_shape",
        statusCode: response.status,
        durationMs,
        error: "Expected JSON array response",
      };
    }

    return {
      provider: "apibay",
      status: "ok",
      statusCode: response.status,
      durationMs,
      error: null,
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - start);
    const isTimeout =
      (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) ||
      controller.signal.aborted;

    return {
      provider: "apibay",
      status: isTimeout ? "timeout" : "http_error",
      statusCode: null,
      durationMs,
      error: isTimeout ? `Timed out after ${timeoutMs}ms` : err instanceof Error ? err.message : "Connection failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeSourceProviders(timeoutMs = 5000): Promise<ProviderHealth[]> {
  return Promise.all([
    probeTorrentio(timeoutMs),
    probeApiBay(timeoutMs),
  ]);
}
