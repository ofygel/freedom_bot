import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import type { BotContext } from '../types';

export const autoDelete = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  if (ctx.chat?.id && ctx.session.ephemeralMessages.length > 0) {
    const chatId = ctx.chat.id;
    const messages = [...ctx.session.ephemeralMessages];
    ctx.session.ephemeralMessages = [];

    for (const messageId of messages) {
      try {
        await ctx.telegram.deleteMessage(chatId, messageId);
      } catch (error) {
        logger.warn(
          { err: error, chatId, messageId },
          'Failed to auto-delete message',
        );
      }
    }
  }

  if (
    ctx.callbackQuery &&
    'data' in ctx.callbackQuery &&
    ctx.session.ui.homeActions.includes(ctx.callbackQuery.data)
  ) {
    const stepEntries = Object.entries(ctx.session.ui.steps);
    if (stepEntries.length > 0) {
      for (const [stepId, step] of stepEntries) {
        if (!step || !step.cleanup) {
          continue;
        }

        try {
          await ctx.telegram.deleteMessage(step.chatId, step.messageId);
        } catch (error) {
          logger.debug(
            { err: error, chatId: step.chatId, messageId: step.messageId, stepId },
            'Failed to delete step message when navigating home',
          );
        }

        delete ctx.session.ui.steps[stepId];
      }
    }
  }

  await next();
};
