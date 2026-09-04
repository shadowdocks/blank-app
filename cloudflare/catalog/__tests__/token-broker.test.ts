import { describe, expect, it } from "bun:test";
import {
  TokenBroker,
  type CachedToken,
  type DurableObjectState,
} from "../token-broker";
import type { CatalogEnv } from "../env";

function createMockState(initialStorage: Record<string, any> = {}): DurableObjectState & {
  store: Record<string, any>;
} {
  const store = { ...initialStorage };
  return {
    store,
    blockConcurrencyWhile: async (cb) => {
      await cb();
    },
    storage: {
      get: async <T>(key: string) => store[key] as T | undefined,
      put: async <T>(key: string, value: T) => {
        store[key] = value;
      },
    },
  };
}

describe("TokenBroker Durable Object", () => {
  it("returns cached token from storage if still valid", async () => {
    const validToken: CachedToken = {
      token: "valid-token-123",
      userAgent: "custom-ua",
      expiresAt: Date.now() + 3600 * 1000,
    };

    const state = createMockState({ token: validToken });
    let mintCount = 0;
    const minter = async () => {
      mintCount++;
      return {
        token: "fresh-token-456",
        userAgent: "fresh-ua",
        expiresAt: Date.now() + 3600 * 1000,
      };
    };

    const broker = new TokenBroker(state, {} as CatalogEnv, minter);
    const token = await broker.getToken(null, "req-1");

    expect(token.token).toBe("valid-token-123");
    expect(mintCount).toBe(0);
  });

  it("mints and stores token on cache miss", async () => {
    const state = createMockState({});
    let mintCount = 0;
    const minter = async () => {
      mintCount++;
      return {
        token: "minted-token-789",
        userAgent: "minted-ua",
        expiresAt: Date.now() + 3600 * 1000,
      };
    };

    const broker = new TokenBroker(state, {} as CatalogEnv, minter);
    const token = await broker.getToken(null, "req-2");

    expect(token.token).toBe("minted-token-789");
    expect(mintCount).toBe(1);
    expect(state.store.token.token).toBe("minted-token-789");
  });

  it("single-flights concurrent mint requests", async () => {
    const state = createMockState({});
    let mintCount = 0;

    const minter = async () => {
      mintCount++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        token: `flight-token-${mintCount}`,
        userAgent: "ua",
        expiresAt: Date.now() + 3600 * 1000,
      };
    };

    const broker = new TokenBroker(state, {} as CatalogEnv, minter);

    const [t1, t2, t3, t4, t5] = await Promise.all([
      broker.getToken(null, "req-a"),
      broker.getToken(null, "req-b"),
      broker.getToken(null, "req-c"),
      broker.getToken(null, "req-d"),
      broker.getToken(null, "req-e"),
    ]);

    expect(mintCount).toBe(1);
    expect(t1.token).toBe("flight-token-1");
    expect(t2.token).toBe("flight-token-1");
    expect(t3.token).toBe("flight-token-1");
    expect(t4.token).toBe("flight-token-1");
    expect(t5.token).toBe("flight-token-1");
  });

  it("re-mints when rejectedToken matches cached token", async () => {
    const initialToken: CachedToken = {
      token: "bad-token-403",
      userAgent: "ua",
      expiresAt: Date.now() + 3600 * 1000,
    };
    const state = createMockState({ token: initialToken });

    let mintCalls = 0;
    const minter = async () => {
      mintCalls++;
      return {
        token: `renewed-token-${mintCalls}`,
        userAgent: "ua",
        expiresAt: Date.now() + 3600 * 1000,
      };
    };

    const broker = new TokenBroker(state, {} as CatalogEnv, minter);

    const t1 = await broker.getToken("bad-token-403", "req-reject-1");
    expect(t1.token).toBe("renewed-token-1");
    expect(mintCalls).toBe(1);

    // If another request passes the old rejected token, it should receive the renewed token without minting again
    const t2 = await broker.getToken("bad-token-403", "req-reject-2");
    expect(t2.token).toBe("renewed-token-1");
    expect(mintCalls).toBe(1);
  });
});
