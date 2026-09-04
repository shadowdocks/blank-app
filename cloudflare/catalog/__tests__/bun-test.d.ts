declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;

  export interface Matchers<T> {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeNull(): void;
    toContain(expected: string | unknown): void;
    toBeGreaterThan(expected: number): void;
    rejects: {
      toThrow(expected?: string | RegExp): Promise<void>;
    };
    not: Matchers<T>;
  }

  export function expect<T = unknown>(actual: T): Matchers<T>;
}
