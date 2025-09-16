import type { PoolClient } from './client';

import type { SessionState } from '../bot/types';

export type SessionScope = 'chat' | 'user';

export interface SessionKey {
  scope: SessionScope;
  scopeId: string;
}

interface SessionRow {
  state: SessionState | string | null;
}

type Queryable = Pick<PoolClient, 'query'>;

const parseSessionState = (value: SessionRow['state']): SessionState => {
  if (value === null || value === undefined) {
    throw new Error('Session payload is empty');
  }

  if (typeof value === 'string') {
    return JSON.parse(value) as SessionState;
  }

  if (typeof value === 'object') {
    return value as SessionState;
  }

  throw new Error('Unsupported session payload type');
};

export const loadSessionState = async (
  client: PoolClient,
  key: SessionKey,
  options: { forUpdate?: boolean } = {},
): Promise<SessionState | null> => {
  const lockClause = options.forUpdate ? ' FOR UPDATE' : '';
  const { rows } = await client.query<SessionRow>(
    `
      SELECT state
      FROM sessions
      WHERE scope = $1 AND scope_id = $2${lockClause}
    `,
    [key.scope, key.scopeId],
  );

  const [row] = rows;
  if (!row) {
    return null;
  }

  try {
    return parseSessionState(row.state);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
    throw new Error(
      `Failed to parse session state for ${key.scope}:${key.scopeId}: ${reason}`,
    );
  }
};

export const saveSessionState = async (
  queryable: Queryable,
  key: SessionKey,
  state: SessionState,
): Promise<void> => {
  let payload: string;
  try {
    payload = JSON.stringify(state);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
    throw new Error(`Failed to serialise session state: ${reason}`);
  }

  await queryable.query(
    `
      INSERT INTO sessions (scope, scope_id, state)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (scope, scope_id) DO UPDATE
      SET state = EXCLUDED.state,
          updated_at = now()
    `,
    [key.scope, key.scopeId, payload],
  );
};

export const deleteSessionState = async (
  queryable: Queryable,
  key: SessionKey,
): Promise<void> => {
  await queryable.query(`DELETE FROM sessions WHERE scope = $1 AND scope_id = $2`, [
    key.scope,
    key.scopeId,
  ]);
};

