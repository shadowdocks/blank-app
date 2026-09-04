import { UpstreamError, type CatalogEnv } from "./env";
import type { SuggestionItem } from "./normalize";
import { GRAPHQL_URL, IMDB_HOME, type CachedToken } from "./token-broker";

export async function searchSuggestions(
  query: string,
  timeoutMs = 10_000
): Promise<SuggestionItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const bucket = encodeURIComponent(trimmed[0].toLowerCase());
  const url = `https://v3.sg.media-imdb.com/suggestion/${bucket}/${encodeURIComponent(trimmed)}.json`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new UpstreamError(`IMDb search returned HTTP ${response.status}`, 502);
    }

    const body = (await response.json()) as { d?: SuggestionItem[] };
    return body.d ?? [];
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(
      err instanceof Error ? err.message : "Failed to fetch IMDb search suggestions",
      502
    );
  }
}

interface GraphqlResponseBody<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function executeGraphql<T>(
  token: CachedToken,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs: number
): Promise<{ status: number; body: GraphqlResponseBody<T> }> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `aws-waf-token=${token.token}`,
      Origin: IMDB_HOME,
      Referer: `${IMDB_HOME}/`,
      "User-Agent": token.userAgent,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let body: GraphqlResponseBody<T> = {};

  try {
    body = JSON.parse(text) as GraphqlResponseBody<T>;
  } catch {
    if (response.ok) {
      throw new UpstreamError("IMDb GraphQL returned invalid JSON", 502);
    }
  }

  return { status: response.status, body };
}

export async function imdbGraphql<T>(
  env: CatalogEnv,
  requestId: string,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<T> {
  if (!env.TOKEN_BROKER) {
    throw new UpstreamError("TOKEN_BROKER binding is not configured", 503);
  }

  const brokerStub = (
    typeof env.TOKEN_BROKER.getByName === "function"
      ? (env.TOKEN_BROKER as any).getByName("global")
      : env.TOKEN_BROKER.get(env.TOKEN_BROKER.idFromName("global"))
  ) as {
    getToken(rejectedToken: string | null, reqId: string): Promise<CachedToken>;
  };

  let token = await brokerStub.getToken(null, requestId);
  let result = await executeGraphql<T>(token, query, variables, timeoutMs);

  // One retry after HTTP 403 (expired/rejected WAF token)
  if (result.status === 403) {
    token = await brokerStub.getToken(token.token, requestId);
    result = await executeGraphql<T>(token, query, variables, timeoutMs);
  }

  if (result.status < 200 || result.status >= 300 || result.body.errors?.length || !result.body.data) {
    const errorMsg =
      result.body.errors?.map((e) => e.message).join("; ") ?? `HTTP ${result.status}`;
    throw new UpstreamError(`IMDb GraphQL query failed: ${errorMsg}`, 502);
  }

  return result.body.data;
}
