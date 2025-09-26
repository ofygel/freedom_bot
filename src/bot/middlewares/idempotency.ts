import crypto from 'crypto';

import type { BotContext } from '../types';
import { pool } from '../../db';
import { logger } from '../../config';

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
): Promise<{ status: 'ok'; result: T } | { status: 'duplicate' } | { status: 'error' }> => {
  const userId = ctx.auth?.user.telegramId ?? ctx.from?.id;
  if (typeof userId !== 'number') {
    return { status: 'duplicate' };
  }

  await removeExpiredKeys(userId);

  const key = buildKey(userId, action, payload);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  let keyInserted = false;
  try {
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
    keyInserted = true;
  } catch (error) {
    logger.error({ err: error, userId, action, payload }, 'Failed to register idempotency key');
    return { status: 'error' };
  }

  try {
    const result = await handler();
    return { status: 'ok', result };
  } catch (error) {
    if (keyInserted) {
      try {
        await pool.query('DELETE FROM recent_actions WHERE user_id = $1 AND key = $2', [userId, key]);
      } catch {
        // swallow cleanup errors, prefer surfacing original failure
      }
    }
    throw error;
  }
};
