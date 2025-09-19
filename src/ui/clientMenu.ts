import { Markup } from 'telegraf';
import type { Telegram } from 'telegraf';
import type { Message } from 'telegraf/typings/core/types/typegram';

import type { BotContext, UserRole } from '../bot/types';

export const CLIENT_MENU = {
  taxi: '🚕 Заказать такси',
  delivery: '📦 Доставка',
  orders: '🧾 Мои заказы',
  support: '🆘 Поддержка',
  city: '🏙️ Сменить город',
  switchRole: '👥 Сменить роль',
  refresh: '🔄 Обновить меню',
} as const;

const buildKeyboard = () =>
  Markup.keyboard([
    [CLIENT_MENU.taxi, CLIENT_MENU.delivery],
    [CLIENT_MENU.orders],
    [CLIENT_MENU.support, CLIENT_MENU.city],
    [CLIENT_MENU.switchRole],
    [CLIENT_MENU.refresh],
  ])
    .resize()
    .persistent();

const DEFAULT_MENU_PROMPT = 'Что дальше? Выберите действие:';

export const sendClientMenu = async (
  ctx: BotContext,
  text: string = DEFAULT_MENU_PROMPT,
): Promise<Message.TextMessage | undefined> => {
  if (!ctx.chat) {
    return undefined;
  }

  try {
    return await ctx.reply(text, buildKeyboard());
  } catch {
    return undefined;
  }
};

export const sendClientMenuToChat = async (
  telegram: Telegram,
  chatId: number,
  text: string = DEFAULT_MENU_PROMPT,
): Promise<Message.TextMessage | undefined> => {
  try {
    return await telegram.sendMessage(chatId, text, buildKeyboard());
  } catch {
    return undefined;
  }
};

export const hideClientMenu = async (
  ctx: BotContext,
  text = 'Ок, продолжаем…',
): Promise<Message.TextMessage | undefined> => {
  if (!ctx.chat) {
    return undefined;
  }

  try {
    return await ctx.reply(text, Markup.removeKeyboard());
  } catch {
    return undefined;
  }
};

export const isClientChat = (ctx: BotContext, role?: UserRole): boolean =>
  ctx.chat?.type === 'private' && (role === 'client' || role === undefined);

export const clientMenuText = (city?: string) =>
  [
    '🎯 Меню клиента',
    city ? `Текущий город: ${city}.` : undefined,
    city ? '' : undefined,
    'Выберите, что хотите оформить:',
    '• 🚕 Такси — подача машины и поездка по указанному адресу.',
    '• 📦 Доставка — курьер заберёт и доставит вашу посылку.',
    '• 🧾 Мои заказы — проверка статуса и управление оформленными заказами.',
    '• 🆘 Поддержка — напишите нам, если нужна помощь.',
    '• 🏙️ Сменить город — обновите географию заказов.',
    '• 👥 Сменить роль — переключитесь на режим исполнителя или клиента.',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
