declare module "bun:sqlite" {
  export class Database {
    constructor(filename?: string, options?: unknown);
    run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    query(sql: string): {
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
      run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
      values(...params: unknown[]): unknown[][];
    };
  }
}

interface ImportMeta {
  dir: string;
}
