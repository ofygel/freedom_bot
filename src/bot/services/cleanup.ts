import { logger } from '../../config';
import type { BotContext } from '../types';

import { safeEditReplyMarkup } from '../../utils/tg';
import { showSafeModeCard } from '../flows/common/safeMode';

const DEFAULT_SAFE_MODE_PROMPT =
  'Мы восстанавливаем данные. Пока доступны действия: [Профиль], [Сменить город], [Помощь].';

export interface EnterSafeModeOptions {
  reason?: string;
  prompt?: string;
  notify?: boolean;
}

export const enterSafeMode = async (
  ctx: BotContext,
  options: EnterSafeModeOptions = {},
): Promise<void> => {
  if (!ctx.session) {
    return;
  }

  const alreadySafe = ctx.session.safeMode === true && ctx.session.isDegraded === true;

  ctx.session.safeMode = true;
  ctx.session.isDegraded = true;
  ctx.session.isAuthenticated = false;
  ctx.session.authSnapshot.status = 'safe_mode';
  ctx.session.authSnapshot.stale = true;

  if (ctx.auth) {
    ctx.auth.user.status = 'safe_mode';
  }

  if (!alreadySafe) {
    logger.warn(
      {
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
        reason: options.reason,
      },
      'Entering safe mode due to state recovery failure',
    );
  }

  const shouldNotify = options.notify ?? true;
  if (alreadySafe || !shouldNotify) {
    return;
  }

  if (ctx.chat?.type !== 'private') {
    return;
  }

  try {
    await showSafeModeCard(ctx, { prompt: options.prompt ?? DEFAULT_SAFE_MODE_PROMPT });
  } catch (error) {
    logger.warn(
      { err: error, chatId: ctx.chat.id },
      'Failed to render safe mode card after recovery failure',
    );
  }
};

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
