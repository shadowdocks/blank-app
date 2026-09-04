import { ensureWebVtt } from "./converter";

const MAX_SUBTITLE_BYTES = 5 * 1024 * 1024; // 5 MB max

function isPrivateIpOrHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return true;
  }

  // Check IPv4 private and link-local ranges
  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4Match) {
    const a = Number.parseInt(ipv4Match[1], 10);
    const b = Number.parseInt(ipv4Match[2], 10);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // Link-local
    if (a === 0) return true;
  }

  return false;
}

function isAllowedSubtitleHost(hostname: string): boolean {
  const suffixes = (process.env.HAWK_SUBTITLE_HOSTS ?? "strem.io,opensubtitles.org")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const host = hostname.toLowerCase();
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function validateSubtitleUrl(rawUrl: string): { valid: boolean; url?: URL; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, reason: "Invalid URL syntax" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "Only http and https protocols are supported" };
  }

  if (isPrivateIpOrHost(parsed.hostname)) {
    return { valid: false, reason: "Access to private or loopback addresses is forbidden" };
  }
  if (!isAllowedSubtitleHost(parsed.hostname)) {
    return { valid: false, reason: "Subtitle host is not allowed" };
  }

  return { valid: true, url: parsed };
}

export async function proxySubtitle(
  targetUrl: string,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<Response> {
  const check = validateSubtitleUrl(targetUrl);
  if (!check.valid || !check.url) {
    return Response.json({ error: check.reason ?? "Invalid subtitle URL." }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let currentUrl = check.url;
    let upstream: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      upstream = await fetch(currentUrl.href, {
        headers: {
          "User-Agent": "hawk/2.0",
          Accept: "text/vtt, text/plain, application/x-subrip, text/x-ssa, */*",
        },
        redirect: "manual",
        signal: controller.signal,
      });
      if (upstream.status < 300 || upstream.status >= 400) break;
      const location = upstream.headers.get("location");
      await upstream.body?.cancel();
      if (!location || redirects === 3) {
        return Response.json({ error: "Subtitle redirect failed" }, { status: 502 });
      }
      const redirected = validateSubtitleUrl(new URL(location, currentUrl).href);
      if (!redirected.valid || !redirected.url) {
        return Response.json({ error: redirected.reason ?? "Subtitle redirect was blocked" }, { status: 400 });
      }
      currentUrl = redirected.url;
    }

    if (!upstream) return Response.json({ error: "Subtitle request failed" }, { status: 502 });

    if (!upstream.ok) {
      return Response.json(
        { error: `Upstream returned HTTP ${upstream.status}` },
        { status: upstream.status >= 500 ? 502 : upstream.status },
      );
    }

    const contentLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SUBTITLE_BYTES) {
      return Response.json({ error: "Subtitle file exceeds maximum permitted size" }, { status: 413 });
    }

    if (!upstream.body) {
      return Response.json({ error: "Empty subtitle response" }, { status: 502 });
    }

    // Read body while enforcing max byte limit
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        receivedBytes += value.byteLength;
        if (receivedBytes > MAX_SUBTITLE_BYTES) {
          await reader.cancel();
          return Response.json({ error: "Subtitle file exceeds maximum permitted size" }, { status: 413 });
        }
        chunks.push(value);
      }
    }

    const totalBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      totalBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const rawText = new TextDecoder("utf-8", { fatal: false }).decode(totalBuffer);
    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";

    let formatHint: "vtt" | "srt" | "ass" | undefined;
    if (contentType.includes("vtt") || currentUrl.pathname.endsWith(".vtt")) {
      formatHint = "vtt";
    } else if (contentType.includes("ssa") || contentType.includes("ass") || currentUrl.pathname.endsWith(".ass")) {
      formatHint = "ass";
    } else if (contentType.includes("subrip") || currentUrl.pathname.endsWith(".srt")) {
      formatHint = "srt";
    }

    const vtt = ensureWebVtt(rawText, formatHint);

    return new Response(vtt, {
      status: 200,
      headers: {
        "content-type": "text/vtt; charset=utf-8",
        "cache-control": "public, max-age=86400",
        "access-control-allow-origin": "*",
        "content-length": String(Buffer.byteLength(vtt, "utf-8")),
      },
    });
  } catch (error: unknown) {
    if (signal?.aborted || controller.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : "Subtitle proxy failed";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function handleSubtitleProxyRequest(requestOrUrl: Request | URL): Promise<Response> {
  const url = requestOrUrl instanceof URL ? requestOrUrl : new URL(requestOrUrl.url);
  const signal = requestOrUrl instanceof Request ? requestOrUrl.signal : undefined;

  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    return Response.json({ error: "A 'url' parameter is required." }, { status: 400 });
  }

  return proxySubtitle(targetUrl, 10_000, signal);
}
