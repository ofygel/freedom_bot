import type { MiddlewareFn } from 'telegraf';

import { executorKeyboard, onboardingKeyboard, removeKeyboard } from '../ui/menus';
import type { BotContext } from '../types';
import { logger } from '../../config';

const GUEST_ALLOWLIST = new Set<string>([
  '/start',
  '/help',
  'Отправить мой номер телефона',
  'Отправить номер',
]);

const isContactMessage = (ctx: BotContext): boolean =>
  Boolean((ctx.message as { contact?: unknown } | undefined)?.contact);

const getMessageText = (ctx: BotContext): string | undefined => {
  const message = ctx.message as { text?: unknown } | undefined;
  if (!message || typeof message.text !== 'string') {
    return undefined;
  }
  const trimmed = message.text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const stateGate = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  const user = ctx.auth?.user;
  const text = getMessageText(ctx);
  const isCallbackQuery = Boolean(ctx.callbackQuery);
  const isChannelChat = ctx.chat?.type === 'channel';

  const answerCallbackQuery = async (message: string) => {
    if (!isCallbackQuery || typeof ctx.answerCbQuery !== 'function') {
      return;
    }

    try {
      await ctx.answerCbQuery(message, { show_alert: false });
    } catch (error) {
      logger.debug({ err: error }, 'Failed to answer callback query in stateGate');
    }
  };

  if (!user || user.status === 'awaiting_phone' || !user.phone) {
    if (!text || GUEST_ALLOWLIST.has(text) || isContactMessage(ctx)) {
      await next();
      return;
    }

    const warning = 'Чтобы продолжить, отправьте номер телефона через кнопку ниже.';
    await answerCallbackQuery(warning);

    if (!isCallbackQuery || !isChannelChat) {
      await ctx.reply(warning, onboardingKeyboard());
    }
    return;
  }

  if (user.status === 'suspended' || user.status === 'banned') {
    const warning = 'Доступ к функциям бота ограничен. Обратитесь в поддержку.';
    await answerCallbackQuery(warning);

    if (!isCallbackQuery || !isChannelChat) {
      await ctx.reply(warning, removeKeyboard());
    }
    return;
  }

  if (user.status === 'trial_expired') {
    const warning =
      'Пробный период завершён. Продлите подписку, чтобы продолжить получать заказы.';
    await answerCallbackQuery(warning);

    if (!isCallbackQuery || !isChannelChat) {
      await ctx.reply(warning, executorKeyboard());
    }
    return;
  }

  await next();
};
