import type { CatalogEnv } from "./env";

export const IMDB_HOME = "https://www.imdb.com";
export const GRAPHQL_URL = "https://api.graphql.imdb.com/";
export const TOKEN_KEY = "token";
export const TOKEN_TTL_SECONDS = 3 * 24 * 60 * 60; // 3 days
export const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

export interface CachedToken {
  token: string;
  userAgent: string;
  expiresAt: number;
}

export interface DurableObjectState {
  blockConcurrencyWhile<T>(callback: () => Promise<T>): void;
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put<T>(key: string, value: T): Promise<void>;
  };
}

type AbstractConstructor = abstract new (...args: any[]) => any;

let BaseDurableObject: AbstractConstructor = class {
  protected ctx: DurableObjectState;
  protected env: CatalogEnv;
  constructor(ctx: DurableObjectState, env: CatalogEnv) {
    this.ctx = ctx;
    this.env = env;
  }
};

try {
  // @ts-ignore
  const cw = await import("cloudflare:workers");
  if (cw?.DurableObject) {
    BaseDurableObject = cw.DurableObject;
  }
} catch {
  // Fallback in unit test / non-workerd environments
}

export async function defaultMintToken(env: CatalogEnv, requestId = ""): Promise<CachedToken> {
  const startedAt = Date.now();
  if (!env.BROWSER) {
    throw new Error("BROWSER binding is not configured");
  }

  const puppeteer = (await import("@cloudflare/puppeteer")).default;
  const browser = await puppeteer.launch(env.BROWSER as any);

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    await page.goto(`${IMDB_HOME}/title/tt0468569/`, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });

    const deadline = Date.now() + 25_000;
    let token: string | undefined;

    while (Date.now() < deadline) {
      const cookies = await page.cookies(IMDB_HOME);
      token = cookies.find((cookie) => cookie.name === "aws-waf-token")?.value;
      if (token) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!token) {
      throw new Error("IMDb did not issue an AWS WAF token within 25 seconds");
    }

    const cached: CachedToken = {
      token,
      userAgent: USER_AGENT,
      expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1_000,
    };

    return cached;
  } finally {
    await browser.close();
  }
}

export class TokenBroker extends BaseDurableObject {
  private cached: CachedToken | null = null;
  private minting: Promise<CachedToken> | null = null;
  private minter: (env: CatalogEnv, requestId: string) => Promise<CachedToken>;
  private initPromise: Promise<void> | null = null;

  constructor(
    ctx: DurableObjectState,
    env: CatalogEnv,
    minter?: (env: CatalogEnv, requestId: string) => Promise<CachedToken>
  ) {
    super(ctx, env);
    this.minter = minter ?? defaultMintToken;

    if (typeof ctx?.blockConcurrencyWhile === "function") {
      const init = async () => {
        this.cached = (await ctx.storage?.get<CachedToken>(TOKEN_KEY)) ?? null;
      };
      this.initPromise = init();
      ctx.blockConcurrencyWhile(() => this.initPromise!);
    }
  }

  async getToken(rejectedToken: string | null = null, requestId = ""): Promise<CachedToken> {
    if (this.initPromise) {
      await this.initPromise;
    }

    const valid = this.cached?.token && this.cached.expiresAt > Date.now() + 60_000;
    const anotherRequestRefreshed = rejectedToken && this.cached?.token !== rejectedToken;

    if (valid && (!rejectedToken || anotherRequestRefreshed)) {
      return this.cached!;
    }

    this.minting ??= this.minter(this.env, requestId)
      .then(async (token) => {
        this.cached = token;
        if (typeof this.ctx?.storage?.put === "function") {
          await this.ctx.storage.put(TOKEN_KEY, token);
        }
        return token;
      })
      .finally(() => {
        this.minting = null;
      });

    return this.minting;
  }
}
