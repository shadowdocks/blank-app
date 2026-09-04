declare module "bun:test" {
  export function describe(name: string, fn: () => void | Promise<void>): void
  export function it(name: string, fn: () => void | Promise<void>): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function expect(value?: unknown): {
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toBeInstanceOf(expected: unknown): void
    toBeNull(): void
    toBeUndefined(): void
    toBeDefined(): void
    toBeTruthy(): void
    toBeFalsy(): void
    toBeGreaterThan(expected: number): void
    toBeGreaterThanOrEqual(expected: number): void
    toBeLessThan(expected: number): void
    toBeLessThanOrEqual(expected: number): void
    toContain(expected: unknown): void
    toHaveLength(expected: number): void
    toThrow(expected?: unknown): void
    rejects: {
      toThrow(expected?: unknown): Promise<void>
    }
    unreachable(): never
    not: {
      toBe(expected: unknown): void
      toEqual(expected: unknown): void
      toBeNull(): void
      toBeUndefined(): void
      toBeDefined(): void
      toBeTruthy(): void
      toBeFalsy(): void
      toContain(expected: unknown): void
      toThrow(expected?: unknown): void
    }
  }
}
