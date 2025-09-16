import { logger } from '../../config';
import type { BotContext } from '../types';

import { safeEditReplyMarkup } from '../../utils/tg';

export const rememberEphemeralMessage = (
  ctx: BotContext,
  messageId?: number,
): void => {
  if (!messageId) {
    return;
  }

  ctx.session.ephemeralMessages.push(messageId);
};

export const clearInlineKeyboard = async (
  ctx: BotContext,
  messageId?: number,
): Promise<boolean> => {
  if (!messageId || !ctx.chat) {
    return false;
  }

  const success = await safeEditReplyMarkup(
    ctx.telegram,
    ctx.chat.id,
    messageId,
    undefined,
  );

  if (!success) {
    logger.debug(
      { chatId: ctx.chat.id, messageId },
      'Failed to clear inline keyboard',
    );
  }

  return success;
};
