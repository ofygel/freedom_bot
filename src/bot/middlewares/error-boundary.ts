import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import type { BotContext } from '../types';

export const errorBoundary = (): MiddlewareFn<BotContext> =>
  async (ctx, next) => {
    try {
      await next();
    } catch (error) {
      logger.error(
        { err: error, update: ctx.update },
        'Unhandled error while processing update',
      );

      if (!ctx.chat) {
        return;
      }

      try {
        await ctx.reply('Произошла непредвиденная ошибка. Попробуйте позже.');
      } catch (replyError) {
        logger.error({ err: replyError }, 'Failed to notify user about error');
      }
    }
  };
