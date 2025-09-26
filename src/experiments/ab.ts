import crypto from 'crypto';

import { hasUiEventsTable, hasUserExperimentsTable, pool } from '../db';

export type Variant = 'A' | 'B';

const decideVariant = (userId: number, experiment: string): Variant => {
  const hash = crypto.createHash('sha1').update(`${userId}:${experiment}`).digest();
  return hash[0] % 2 === 0 ? 'A' : 'B';
};

export async function getVariant(userId: number, experiment: string): Promise<Variant> {
  if (!(await hasUserExperimentsTable())) {
    return decideVariant(userId, experiment);
  }

  const existing = await pool.query<{ variant: Variant }>(
    'SELECT variant FROM user_experiments WHERE user_id = $1 AND experiment = $2',
    [userId, experiment],
  );

  if (existing.rowCount && existing.rows[0]?.variant) {
    return existing.rows[0].variant;
  }

  const variant = decideVariant(userId, experiment);
  await pool.query(
    'INSERT INTO user_experiments(user_id, experiment, variant) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [userId, experiment, variant],
  );

  return variant;
}

export async function logUiEvent(
  userId: number,
  event: 'expose' | 'click',
  target: string,
  experiment?: string,
  variant?: Variant,
  context: unknown = {},
): Promise<void> {
  if (!(await hasUiEventsTable())) {
    return;
  }

  await pool.query(
    'INSERT INTO ui_events(user_id, experiment, variant, event, target, context) VALUES ($1, $2, $3, $4, $5, $6::jsonb)',
    [userId, experiment ?? null, variant ?? null, event, target, JSON.stringify(context ?? {})],
  );
}
