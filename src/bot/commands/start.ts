import { Markup, Telegraf } from 'telegraf';

import type { BotContext } from '../types';
import { phoneCollect } from '../flows/common/phoneCollect';
import { setChatCommands } from '../services/commands';
import { CLIENT_COMMANDS, EXECUTOR_COMMANDS } from './sets';

type RoleKey = 'client' | 'courier' | 'driver';

interface RoleOption {
  key: RoleKey;
  label: string;
  description: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    key: 'client',
    label: '🧑‍💼 Я клиент',
    description: 'Оформление заказов на такси и доставку.',
  },
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

export const presentRoleSelection = async (ctx: BotContext): Promise<void> => {
  const description = ROLE_OPTIONS.map((option) => `• ${option.label} — ${option.description}`)
    .join('\n');

  await ctx.reply(
    ['Выберите роль, чтобы продолжить работу с ботом:', description].join('\n\n'),
    buildRoleKeyboard(),
  );
};

const applyCommandsForRole = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const role = ctx.auth?.user.role;
  if (role === 'client' || role === undefined) {
    await setChatCommands(ctx.telegram, ctx.chat.id, CLIENT_COMMANDS);
    return;
  }

  if (role === 'courier' || role === 'driver') {
    await setChatCommands(ctx.telegram, ctx.chat.id, EXECUTOR_COMMANDS);
  }
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

    await applyCommandsForRole(ctx);
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
    await applyCommandsForRole(ctx);
    await presentRoleSelection(ctx);
  });
};

