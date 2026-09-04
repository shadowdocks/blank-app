import { handleCatalogRequest, TokenBroker } from "./catalog";
import type { CatalogEnv } from "./catalog/env";
import { proxyRequest, type ProxyEnv } from "./proxy";
import { handleUserRequest, type UserEnv } from "./user";

export { TokenBroker };

export type HawkEnv = CatalogEnv & ProxyEnv & Partial<UserEnv>;

function unavailableUserResponse(): Response {
  return new Response(JSON.stringify({
    error: "Accounts are not configured yet",
    code: "ACCOUNTS_UNAVAILABLE",
  }), {
    status: 503,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

function hardened(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-hawk-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: HawkEnv, ctx: ExecutionContext): Promise<Response> {
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
    const pathname = new URL(request.url).pathname.replace(/^\/~\/\+/, "");
    let response: Response;
    if (pathname.startsWith("/api/catalog/")) {
      response = await handleCatalogRequest(request, env, ctx);
    } else if (
      pathname.startsWith("/api/auth/") ||
      pathname.startsWith("/api/user/") ||
      pathname.startsWith("/api/public/profile/")
    ) {
      response = env.DB
        ? (await handleUserRequest(request, env as UserEnv, ctx)) ?? new Response(null, { status: 404 })
        : unavailableUserResponse();
    } else {
      response = await proxyRequest(request, env, requestId);
    }
    return hardened(response, requestId);
  },
};
