import type { Telegraf } from 'telegraf';

import { logger } from '../../../config';
import { hideClientMenu } from '../../../ui/clientMenu';
import { updateUserRole } from '../../../db/users';
import { EXECUTOR_COMMANDS } from '../../commands/sets';
import { setChatCommands } from '../../services/commands';
import type { BotContext, ExecutorRole } from '../../types';
import { ui } from '../../ui';
import { askCity, CITY_CONFIRM_STEP_ID } from '../common/citySelect';
import { ensureExecutorState } from './menu';
import { getExecutorRoleCopy } from '../../copy';
import {
  ROLE_SELECTION_BACK_ACTION,
  EXECUTOR_ROLE_PENDING_CITY_ACTION,
} from './roleSelectionConstants';

const ROLE_COURIER_ACTION = 'role:courier';
const ROLE_DRIVER_ACTION = 'role:driver';

const handleRoleSelection = async (ctx: BotContext, role: ExecutorRole): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.answerCbQuery('Пожалуйста, продолжите в личных сообщениях с ботом.');
    return;
  }

  const state = ensureExecutorState(ctx);
  state.role = role;
  state.awaitingRoleSelection = false;
  state.roleSelectionStage = 'city';
  ctx.auth.user.role = 'executor';
  ctx.auth.user.executorKind = role;
  ctx.auth.user.status = 'active_executor';

  try {
    await updateUserRole({
      telegramId: ctx.auth.user.telegramId,
      role: 'executor',
      executorKind: role,
      status: 'active_executor',
      menuRole: 'courier',
    });
  } catch (error) {
    logger.error(
      { err: error, telegramId: ctx.auth.user.telegramId },
      'Failed to persist executor role selection',
    );
  }

  const { genitive } = getExecutorRoleCopy(role);
  await ctx.answerCbQuery(`Вы выбрали роль ${genitive}.`);

  let deleted = false;
  try {
    await ctx.deleteMessage();
    deleted = true;
  } catch (error) {
    logger.debug(
      { err: error, chatId: ctx.chat.id },
      'Failed to delete executor role selection message',
    );
  }

  if (!deleted) {
    try {
      await ctx.editMessageReplyMarkup(undefined);
    } catch (error) {
      logger.debug(
        { err: error, chatId: ctx.chat.id },
        'Failed to clear role selection inline keyboard',
      );
    }
  }

  await setChatCommands(ctx.telegram, ctx.chat.id, EXECUTOR_COMMANDS, { showMenuButton: true });

  await hideClientMenu(ctx, 'Переключаемся…');
  ctx.session.ui.pendingCityAction = EXECUTOR_ROLE_PENDING_CITY_ACTION;
  await askCity(ctx, 'Сначала выбери город для работы', {
    homeAction: ROLE_SELECTION_BACK_ACTION,
    homeLabel: '⬅️ Назад',
  });
  await ui.trackStep(ctx, {
    id: CITY_CONFIRM_STEP_ID,
    homeAction: ROLE_SELECTION_BACK_ACTION,
  });
};

export const registerExecutorRoleSelect = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_COURIER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'courier');
  });

  bot.action(ROLE_DRIVER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'driver');
  });
};
