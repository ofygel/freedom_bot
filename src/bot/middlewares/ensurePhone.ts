import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { pool } from '../../db';
import type { BotContext } from '../types';
import { askPhone } from './askPhone';

export const ensurePhone: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  const fromId = ctx.from?.id;
  if (!fromId) {
    await next();
    return;
  }

  if (ctx.session.user?.phoneVerified || ctx.auth?.user?.phoneVerified) {
    await next();
    return;
  }

  try {
    const { rows } = await pool.query<{ phone_verified: boolean }>(
      'SELECT phone_verified FROM users WHERE tg_id = $1',
      [fromId],
    );

    if (rows[0]?.phone_verified) {
      const existingUser = ctx.session.user ?? { id: fromId };
      ctx.session.user = { ...existingUser, phoneVerified: true };
      if (ctx.auth?.user) {
        ctx.auth.user.phoneVerified = true;
      }
      await next();
      return;
    }
  } catch (error) {
    logger.error({ err: error, telegramId: fromId }, 'Failed to check phone verification');
  }

  await askPhone(ctx);
};
