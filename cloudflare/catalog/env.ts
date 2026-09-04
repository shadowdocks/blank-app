/**
 * Typed environment and error interfaces for Cloudflare Catalog worker.
 */

export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface BrowserRun {
  fetch?: unknown;
  [key: string]: unknown;
}

export interface DurableObjectId {
  toString(): string;
  equals(other: DurableObjectId): boolean;
}

export interface DurableObjectStub {
  fetch(requestOrUrl: Request | string, init?: RequestInit): Promise<Response>;
  [key: string]: unknown;
}

export interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
  getByName?(name: string): DurableObjectStub;
}

export interface CatalogEnv {
  BROWSER?: BrowserRun;
  TOKEN_BROKER?: DurableObjectNamespace;
  API_RATE_LIMITER?: RateLimit;
  TMDB_API_KEY?: string;
  [key: string]: unknown;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export class ResponseError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
    readonly code: string = "BAD_REQUEST"
  ) {
    super(message);
    this.name = "ResponseError";
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
    readonly code: string = "UPSTREAM_ERROR"
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
