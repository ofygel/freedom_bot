import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import type { BotContext } from '../types';

export const auth = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  if (!ctx.from) {
    logger.warn({ update: ctx.update }, 'Received update without sender information');
    return;
  }

  ctx.session.user = {
    id: ctx.from.id,
    username: ctx.from.username ?? undefined,
    firstName: ctx.from.first_name ?? undefined,
    lastName: ctx.from.last_name ?? undefined,
  };
  ctx.session.isAuthenticated = true;

  await next();
};
