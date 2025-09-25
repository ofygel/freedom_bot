import crypto from 'crypto';

import type { BotContext } from '../types';
import { pool } from '../../db';

const DEFAULT_TTL_SECONDS = 60;

const buildKey = (userId: number, action: string, payload?: string): string =>
  crypto.createHash('sha1').update(`${userId}:${action}:${payload ?? ''}`).digest('hex');

const removeExpiredKeys = async (userId: number): Promise<void> => {
  try {
    await pool.query('DELETE FROM recent_actions WHERE user_id = $1 AND expires_at < now()', [userId]);
  } catch {
    // ignore cleanup failures
  }
};

export const withIdempotency = async <T>(
  ctx: BotContext,
  action: string,
  payload: string | undefined,
  handler: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<{ status: 'ok'; result: T } | { status: 'duplicate' }> => {
  const userId = ctx.auth?.user.telegramId ?? ctx.from?.id;
  if (typeof userId !== 'number') {
    return { status: 'duplicate' };
  }

  await removeExpiredKeys(userId);

  const key = buildKey(userId, action, payload);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const insertResult = await pool.query(
    `
      INSERT INTO recent_actions (user_id, key, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `,
    [userId, key, expiresAt.toISOString()],
  );

  if (insertResult.rowCount === 0) {
    return { status: 'duplicate' };
  }

  try {
    const result = await handler();
    return { status: 'ok', result };
  } catch (error) {
    try {
      await pool.query('DELETE FROM recent_actions WHERE user_id = $1 AND key = $2', [userId, key]);
    } catch {
      // swallow cleanup errors, prefer surfacing original failure
    }
    throw error;
  }
};
