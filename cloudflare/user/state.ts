import {
  DEFAULT_USER_STATE,
  type D1Database,
  type HawkUserState,
  type UserStateRecord,
} from "./types";
import { sanitizeUserState } from "./validation";

export interface UserStateData {
  revision: number;
  state: HawkUserState;
  updatedAt: number;
}

export type SyncUpdateResult =
  | {
      ok: true;
      revision: number;
      state: HawkUserState;
    }
  | {
      ok: false;
      conflict: true;
      serverRevision: number;
      serverState: HawkUserState;
    };

export async function getUserState(
  db: D1Database,
  userId: string
): Promise<UserStateData> {
  const row = await db
    .prepare("SELECT user_id, revision, state_json, updated_at FROM user_state WHERE user_id = ?")
    .bind(userId)
    .first<UserStateRecord>();

  if (!row) {
    return {
      revision: 0,
      state: DEFAULT_USER_STATE,
      updatedAt: 0,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.state_json);
  } catch {
    parsed = DEFAULT_USER_STATE;
  }

  return {
    revision: row.revision,
    state: sanitizeUserState(parsed),
    updatedAt: row.updated_at,
  };
}

export async function syncUserState(
  db: D1Database,
  userId: string,
  baseRevision: number,
  rawState: unknown,
  now = Date.now()
): Promise<SyncUpdateResult> {
  const sanitized = sanitizeUserState(rawState);
  const stateJson = JSON.stringify(sanitized);

  const existing = await db
    .prepare("SELECT user_id, revision, state_json, updated_at FROM user_state WHERE user_id = ?")
    .bind(userId)
    .first<UserStateRecord>();

  if (!existing) {
    if (baseRevision === 0) {
      try {
        await db
          .prepare(
            `INSERT INTO user_state (user_id, revision, state_json, updated_at)
             VALUES (?, 1, ?, ?)`
          )
          .bind(userId, stateJson, now)
          .run();

        return {
          ok: true,
          revision: 1,
          state: sanitized,
        };
      } catch {
        // Race condition: another request inserted user_state
        const current = await getUserState(db, userId);
        return {
          ok: false,
          conflict: true,
          serverRevision: current.revision,
          serverState: current.state,
        };
      }
    }

    return {
      ok: false,
      conflict: true,
      serverRevision: 0,
      serverState: DEFAULT_USER_STATE,
    };
  }

  if (existing.revision !== baseRevision) {
    let serverState: HawkUserState;
    try {
      serverState = sanitizeUserState(JSON.parse(existing.state_json));
    } catch {
      serverState = DEFAULT_USER_STATE;
    }
    return {
      ok: false,
      conflict: true,
      serverRevision: existing.revision,
      serverState,
    };
  }

  const nextRevision = baseRevision + 1;
  const result = await db
    .prepare(
      `UPDATE user_state
       SET revision = ?, state_json = ?, updated_at = ?
       WHERE user_id = ? AND revision = ?`
    )
    .bind(nextRevision, stateJson, now, userId, baseRevision)
    .run();

  if ((result.meta?.changes ?? 0) === 1) {
    return {
      ok: true,
      revision: nextRevision,
      state: sanitized,
    };
  }

  // Concurrent update won
  const current = await getUserState(db, userId);
  return {
    ok: false,
    conflict: true,
    serverRevision: current.revision,
    serverState: current.state,
  };
}
