import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  D1Database,
  D1ExecResult,
  D1PreparedStatement,
  D1Result,
} from "../types";

class MockPreparedStatement implements D1PreparedStatement {
  private db: Database;
  private sql: string;
  private params: unknown[] = [];

  constructor(db: Database, sql: string, params: unknown[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MockPreparedStatement(this.db, this.sql, values);
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.query(this.sql);
    const row = stmt.get(...(this.params as (string | number | boolean | null | Uint8Array)[])) as Record<string, unknown> | null;
    if (!row) {
      return null;
    }
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return row as T;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.db.query(this.sql);
    const info = stmt.run(...(this.params as (string | number | boolean | null | Uint8Array)[]));
    return {
      success: true,
      meta: {
        changes: info.changes,
        last_row_id: Number(info.lastInsertRowid),
      },
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const stmt = this.db.query(this.sql);
    const results = stmt.all(...(this.params as (string | number | boolean | null | Uint8Array)[])) as T[];
    return {
      success: true,
      results,
      meta: {
        changes: 0,
      },
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
    const stmt = this.db.query(this.sql);
    return stmt.values(...(this.params as (string | number | boolean | null | Uint8Array)[])) as T[];
  }
}

export function createMockD1(): D1Database {
  const sqlite = new Database(":memory:");

  // Run migration
  const migrationPath = resolve(
    import.meta.dir,
    "../../migrations/0001_create_user_tables.sql"
  );
  const migrationSql = readFileSync(migrationPath, "utf-8");
  sqlite.run(migrationSql);

  return {
    prepare(query: string): D1PreparedStatement {
      return new MockPreparedStatement(sqlite, query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      sqlite.run("BEGIN");
      try {
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
          results.push(await stmt.run<T>());
        }
        sqlite.run("COMMIT");
        return results;
      } catch (err) {
        sqlite.run("ROLLBACK");
        throw err;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      sqlite.run(query);
      return { count: 1, duration: 0 };
    },
  };
}
