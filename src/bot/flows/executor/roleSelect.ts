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
  EXECUTOR_KIND_COURIER_ACTION,
  EXECUTOR_KIND_DRIVER_ACTION,
} from './roleSelectionConstants';
import { clearOnboardingState } from '../../services/onboarding';
import { reportRoleSet, toUserIdentity } from '../../services/reports';

export const handleRoleSelection = async (ctx: BotContext, role: ExecutorRole): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.answerCbQuery('Пожалуйста, продолжите в личных сообщениях с ботом.');
    return;
  }

  const state = ensureExecutorState(ctx);
  state.role = role;
  state.awaitingRoleSelection = true;
  state.roleSelectionStage = 'city';
  const previousRole = ctx.auth.user.role;
  const previousExecutorRole = ctx.auth.user.executorKind;
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

  const identity = ctx.auth?.user
    ? {
        telegramId: ctx.auth.user.telegramId,
        username: ctx.auth.user.username,
        firstName: ctx.auth.user.firstName,
        lastName: ctx.auth.user.lastName,
        phone: ctx.auth.user.phone ?? ctx.session.phoneNumber,
      }
    : toUserIdentity(ctx.from);

  try {
    await reportRoleSet(ctx.telegram, {
      user: identity,
      role: 'executor',
      previousRole,
      executorRole: role,
      previousExecutorRole,
      city: ctx.auth.user.citySelected,
      source: 'executor_role_select',
    });
  } catch (error) {
    logger.error({ err: error, telegramId: ctx.auth.user.telegramId }, 'Failed to report executor role set');
  }

  const { genitive } = getExecutorRoleCopy(role);
  await ctx.answerCbQuery(`Вы выбрали роль ${genitive}. Теперь определим город.`);

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
  clearOnboardingState(ctx);
};

export const registerExecutorRoleSelect = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_KIND_COURIER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'courier');
  });

  bot.action(EXECUTOR_KIND_DRIVER_ACTION, async (ctx) => {
    await handleRoleSelection(ctx, 'driver');
  });
};
