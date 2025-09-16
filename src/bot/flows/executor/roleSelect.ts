import type { Telegraf } from 'telegraf';

import { logger } from '../../../config';
import type { BotContext } from '../../types';
import { ensureExecutorState, showExecutorMenu } from './menu';

const ROLE_DRIVER_ACTION = 'role:driver';

export const registerExecutorRoleSelect = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_DRIVER_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Пожалуйста, продолжите в личных сообщениях с ботом.');
      return;
    }

    await ctx.answerCbQuery('Вы выбрали роль курьера.');
    ensureExecutorState(ctx);

    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      logger.debug(
        { err: error, chatId: ctx.chat.id },
        'Failed to clear role selection inline keyboard',
      );
    }

    await showExecutorMenu(ctx);
  });
};
