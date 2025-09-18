import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { safeDeleteMessage } from '../../utils/tg';
import { ui } from '../ui';
import type { BotContext } from '../types';

interface MessageReference {
  chatId: number;
  messageId: number;
  chatType?: string;
}

const resolveIncomingMessage = (ctx: BotContext): MessageReference | null => {
  const message = ctx.message as
    | ({ message_id: number; chat?: { id?: number; type?: string }; from?: { is_bot?: boolean } })
    | undefined;

  if (!message || typeof message.message_id !== 'number') {
    return null;
  }

  const chatId = message.chat?.id;
  if (typeof chatId !== 'number') {
    return null;
  }

  if (message.from?.is_bot) {
    return null;
  }

  return {
    chatId,
    messageId: message.message_id,
    chatType: message.chat?.type,
  } satisfies MessageReference;
};

const shouldDeleteIncoming = (ref: MessageReference | null): ref is MessageReference =>
  Boolean(ref && ref.chatType === 'private');

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

  const homeActions = ctx.session.ui?.homeActions ?? [];
  if (
    ctx.callbackQuery &&
    'data' in ctx.callbackQuery &&
    homeActions.includes(ctx.callbackQuery.data)
  ) {
    await ui.clear(ctx);
  }

  const incomingMessage = resolveIncomingMessage(ctx);

  await next();

  if (!shouldDeleteIncoming(incomingMessage)) {
    return;
  }

  const success = await safeDeleteMessage(ctx.telegram, incomingMessage.chatId, incomingMessage.messageId);
  if (!success) {
    logger.debug(
      {
        chatId: incomingMessage.chatId,
        messageId: incomingMessage.messageId,
        chatType: incomingMessage.chatType,
      },
      'Failed to delete incoming message',
    );
  }
};
