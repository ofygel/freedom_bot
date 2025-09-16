import { Markup, Telegraf } from 'telegraf';

import type { BotContext } from '../types';
import { phoneCollect } from '../utils/phone-collect';

type RoleKey = 'courier' | 'driver';

interface RoleOption {
  key: RoleKey;
  label: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    key: 'courier',
    label: '🚚 Я курьер',
    description: 'Получение заказов на доставку и управление сменами.',
  },
  {
    key: 'driver',
    label: '🚗 Я водитель',
    description: 'Получение заказов на поездки и управление сменами.',
  },
];

const buildRoleKeyboard = () =>
  Markup.inlineKeyboard(
    ROLE_OPTIONS.map((option) => [
      Markup.button.callback(option.label, `role:${option.key}`),
    ]),
  );

const presentRoleSelection = async (ctx: BotContext): Promise<void> => {
  const description = ROLE_OPTIONS.map((option) => `• ${option.label} — ${option.description}`)
    .join('\n');

  await ctx.reply(
    ['Выберите роль, чтобы продолжить работу с Freedom Bot:', description].join('\n\n'),
    buildRoleKeyboard(),
  );
};

export const registerStartCommand = (bot: Telegraf<BotContext>): void => {
  bot.start(async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Пожалуйста, начните диалог с ботом в личных сообщениях.');
      return;
    }

    const phone = await phoneCollect(ctx);
    if (!phone) {
      return;
    }

    await presentRoleSelection(ctx);
  });

  bot.on('contact', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      await next();
      return;
    }

    if (!ctx.session.awaitingPhone && ctx.session.phoneNumber) {
      await next();
      return;
    }

    const phone = await phoneCollect(ctx, { allowCached: false });
    if (!phone) {
      return;
    }

    await ctx.reply('Спасибо! Номер телефона получен.', Markup.removeKeyboard());
    await presentRoleSelection(ctx);
  });
};

