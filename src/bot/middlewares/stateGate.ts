import type { MiddlewareFn } from 'telegraf';

import { executorKeyboard, onboardingKeyboard, removeKeyboard } from '../ui/menus';
import type { BotContext } from '../types';

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

  if (!user || user.status === 'awaiting_phone' || !user.phone) {
    if (!text || GUEST_ALLOWLIST.has(text) || isContactMessage(ctx)) {
      await next();
      return;
    }

    await ctx.reply('Чтобы продолжить, отправьте номер телефона через кнопку ниже.', onboardingKeyboard());
    return;
  }

  if (user.status === 'suspended' || user.status === 'banned') {
    await ctx.reply('Доступ к функциям бота ограничен. Обратитесь в поддержку.', removeKeyboard());
    return;
  }

  if (user.status === 'trial_expired') {
    await ctx.reply('Пробный период завершён. Продлите подписку, чтобы продолжить получать заказы.', executorKeyboard());
    return;
  }

  await next();
};
