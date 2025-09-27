import { Markup, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import type { BotContext } from '../types';
import { setChatCommands } from '../services/commands';
import { CLIENT_COMMANDS, EXECUTOR_COMMANDS } from './sets';
import { hideClientMenu } from '../../ui/clientMenu';
import { bindInlineKeyboardToUser } from '../services/callbackTokens';
import { askPhone } from '../flows/common/phoneCollect';
import { ensureExecutorState } from '../flows/executor/menu';
import { startExecutorVerification } from '../flows/executor/verification';
import { startExecutorSubscription } from '../flows/executor/subscription';

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

const buildRoleKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard(
    ROLE_OPTIONS.map((option) => [
      Markup.button.callback(option.label, `role:${option.key}`),
    ]),
  ).reply_markup as InlineKeyboardMarkup;

export const presentRoleSelection = async (ctx: BotContext): Promise<void> => {
  const description = ROLE_OPTIONS.map((option) => `• ${option.label} — ${option.description}`)
    .join('\n');

  const keyboard = buildRoleKeyboard();
  const replyMarkup = bindInlineKeyboardToUser(ctx, keyboard) ?? keyboard;
  await ctx.reply(
    ['Выберите роль, чтобы продолжить работу с ботом:', description].join('\n\n'),
    { reply_markup: replyMarkup },
  );
};

const applyCommandsForRole = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const role = ctx.auth?.user.role;
  if (role === 'client' || role === 'guest' || role === undefined) {
    await setChatCommands(ctx.telegram, ctx.chat.id, CLIENT_COMMANDS, { showMenuButton: true });
    return;
  }

  if (role === 'courier' || role === 'driver') {
    await setChatCommands(ctx.telegram, ctx.chat.id, EXECUTOR_COMMANDS, { showMenuButton: true });
  }
};

export const handleStart = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.reply('Пожалуйста, начните диалог с ботом в личных сообщениях.');
    return;
  }

  if (!ctx.session.user?.phoneVerified) {
    await askPhone(ctx);
    return;
  }

  await applyCommandsForRole(ctx);
  await hideClientMenu(ctx, 'Возвращаю стандартную клавиатуру…');

  const executorState = ensureExecutorState(ctx);
  const role = executorState.role;
  if (!role) {
    await presentRoleSelection(ctx);
    return;
  }
  const verification = executorState.verification[role];
  if (verification.status === 'collecting') {
    await startExecutorVerification(ctx);
    return;
  }

  const subscriptionStatus = executorState.subscription.status;
  if (subscriptionStatus === 'awaitingReceipt' || subscriptionStatus === 'pendingModeration') {
    await startExecutorSubscription(ctx, { skipVerificationCheck: true });
    return;
  }

  await presentRoleSelection(ctx);
};

export const registerStartCommand = (bot: Telegraf<BotContext>): void => {
  bot.start(handleStart);
  bot.hears(/^start$/i, handleStart);

  bot.on('contact', async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      await next();
      return;
    }

    const phoneJustVerified = Boolean(
      (ctx.state as { phoneJustVerified?: unknown }).phoneJustVerified,
    );
    if (!phoneJustVerified) {
      await next();
      return;
    }

    await applyCommandsForRole(ctx);
    await presentRoleSelection(ctx);
  });
};

