import type { Telegraf } from 'telegraf';

import { logger } from '../../../config';
import type { BotContext, ExecutorRole } from '../../types';
import { ensureExecutorState, showExecutorMenu } from './menu';
import { getExecutorRoleCopy } from './roleCopy';

const ROLE_COURIER_ACTION = 'role:courier';
const ROLE_DRIVER_ACTION = 'role:driver';

const handleRoleSelection = async (ctx: BotContext, role: ExecutorRole): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.answerCbQuery('Пожалуйста, продолжите в личных сообщениях с ботом.');
    return;
  }

  const state = ensureExecutorState(ctx);
  state.role = role;

  const { genitive } = getExecutorRoleCopy(role);
  await ctx.answerCbQuery(`Вы выбрали роль ${genitive}.`);

  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (error) {
    logger.debug(
      { err: error, chatId: ctx.chat.id },
      'Failed to clear role selection inline keyboard',
    );
  }

  await showExecutorMenu(ctx);
};

export const registerExecutorRoleSelect = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_COURIER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'courier');
  });

  bot.action(ROLE_DRIVER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'driver');
  });
};
