import { Telegraf } from 'telegraf';

import type { BotContext } from '../types';
import { setChatCommands } from '../services/commands';
import { CLIENT_COMMANDS, EXECUTOR_COMMANDS } from './sets';
import { hideClientMenu, sendClientMenu } from '../../ui/clientMenu';
import { askPhone } from '../flows/common/phoneCollect';
import { ensureExecutorState, showExecutorMenu } from '../flows/executor/menu';
import { startExecutorVerification } from '../flows/executor/verification';
import { startExecutorSubscription } from '../flows/executor/subscription';
import { buildInlineKeyboard } from '../keyboards/common';
import { ui } from '../ui';
import {
  ROLE_SELECTION_BACK_ACTION,
  EXECUTOR_ROLE_PENDING_CITY_ACTION,
} from '../flows/executor/roleSelectionConstants';

const ROLE_SELECTION_STEP_ID = 'start:role:selection';
const ROLE_CLIENT_ACTION = 'role:client';
const ROLE_EXECUTOR_ACTION = 'role:executor';
const ROLE_COURIER_ACTION = 'role:courier';
const ROLE_DRIVER_ACTION = 'role:driver';
const SUPPORT_CONTACT_ACTION = 'support:contact';

const ROLE_SELECTION_TITLE = 'Выбор роли';
const ROLE_SELECTION_DESCRIPTION =
  'Freedom Bot помогает клиентам оформлять заказы и исполнителям брать их в работу. Выберите подходящую роль.';

const SPECIALISATION_TITLE = 'Выбор специализации';
const SPECIALISATION_DESCRIPTION =
  'Уточните, какие заказы хотите получать: доставка подходит курьерам, поездки — водителям.';

const buildRoleSelectionKeyboard = () =>
  buildInlineKeyboard([
    [
      { label: '🧑‍💼 Я клиент', action: ROLE_CLIENT_ACTION },
      { label: '🛠️ Я исполнитель', action: ROLE_EXECUTOR_ACTION },
    ],
    [
      { label: '🆘 Помощь', action: SUPPORT_CONTACT_ACTION },
      { label: '❓ Где я?', action: ROLE_SELECTION_BACK_ACTION },
    ],
  ]);

const buildExecutorSpecialisationKeyboard = () =>
  buildInlineKeyboard([
    [
      { label: '🚚 Я курьер', action: ROLE_COURIER_ACTION },
      { label: '🚗 Я водитель', action: ROLE_DRIVER_ACTION },
    ],
    [
      { label: '🆘 Помощь', action: SUPPORT_CONTACT_ACTION },
      { label: '⬅️ Назад', action: ROLE_SELECTION_BACK_ACTION },
    ],
  ]);

const resetCitySelectionTracking = (ctx: BotContext): void => {
  if (ctx.session.ui?.pendingCityAction === EXECUTOR_ROLE_PENDING_CITY_ACTION) {
    ctx.session.ui.pendingCityAction = undefined;
  }
};

export const presentRoleSelection = async (ctx: BotContext): Promise<void> => {
  const executorState = ensureExecutorState(ctx);
  executorState.awaitingRoleSelection = true;
  executorState.role = undefined;
  executorState.roleSelectionStage = 'role';
  ctx.auth.user.executorKind = undefined;
  resetCitySelectionTracking(ctx);

  await ui.step(ctx, {
    id: ROLE_SELECTION_STEP_ID,
    text: `${ROLE_SELECTION_TITLE}\n\n${ROLE_SELECTION_DESCRIPTION}`,
    keyboard: buildRoleSelectionKeyboard(),
  });
};

export const presentExecutorSpecialisationSelection = async (
  ctx: BotContext,
): Promise<void> => {
  const executorState = ensureExecutorState(ctx);
  executorState.awaitingRoleSelection = true;
  executorState.role = undefined;
  executorState.roleSelectionStage = 'specialization';
  ctx.auth.user.executorKind = undefined;
  resetCitySelectionTracking(ctx);

  await ui.step(ctx, {
    id: ROLE_SELECTION_STEP_ID,
    text: `${SPECIALISATION_TITLE}\n\n${SPECIALISATION_DESCRIPTION}`,
    keyboard: buildExecutorSpecialisationKeyboard(),
  });
};

const applyCommandsForRole = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const role = ctx.auth?.user.role;
  if (role === 'client') {
    await setChatCommands(ctx.telegram, ctx.chat.id, CLIENT_COMMANDS, { showMenuButton: true });
    return;
  }

  if (role === 'executor') {
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
  const userRole = ctx.auth.user.role;
  if (userRole === 'client') {
    await hideClientMenu(ctx, 'Открываю главное меню…');
    await sendClientMenu(ctx, 'Чем займёмся дальше? Выберите действие из меню ниже.');
    return;
  }

  const executorState = ensureExecutorState(ctx);
  const role = executorState.role;
  const stage = executorState.roleSelectionStage;
  const awaitingRoleSelection = executorState.awaitingRoleSelection === true;
  if (!role || awaitingRoleSelection || stage === 'role' || stage === 'specialization') {
    executorState.awaitingRoleSelection = true;
    executorState.role = undefined;
    const prompt = stage === 'specialization'
      ? 'Выберите специализацию исполнителя ниже.'
      : 'Меняем роль — выберите подходящий вариант ниже.';
    await hideClientMenu(ctx, prompt);
    if (stage === 'specialization') {
      await presentExecutorSpecialisationSelection(ctx);
    } else {
      await presentRoleSelection(ctx);
    }
    return;
  }

  const verification = executorState.verification[role];
  if (verification.status === 'idle' || verification.status === 'collecting') {
    await startExecutorVerification(ctx);
    return;
  }

  const subscriptionStatus = executorState.subscription.status;
  if (subscriptionStatus === 'awaitingReceipt' || subscriptionStatus === 'pendingModeration') {
    await startExecutorSubscription(ctx, { skipVerificationCheck: true });
    return;
  }

  await showExecutorMenu(ctx);
};

export const registerStartCommand = (bot: Telegraf<BotContext>): void => {
  bot.start(handleStart);
  bot.hears(/^start$/i, handleStart);

  bot.action(ROLE_EXECUTOR_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.answerCbQuery('Пожалуйста, продолжите в личном чате с ботом.');
      } catch {
        // Ignore
      }
      return;
    }

    const executorState = ensureExecutorState(ctx);
    executorState.awaitingRoleSelection = true;
    executorState.role = undefined;
    executorState.roleSelectionStage = 'specialization';
    ctx.auth.user.executorKind = undefined;
    resetCitySelectionTracking(ctx);

    try {
      await ctx.answerCbQuery('Теперь выберите специализацию.');
    } catch {
      // Ignore callback errors
    }

    await presentExecutorSpecialisationSelection(ctx);
  });

  bot.action(ROLE_SELECTION_BACK_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.answerCbQuery('Доступно только в личном чате с ботом.');
      } catch {
        // Ignore
      }
      return;
    }

    const executorState = ensureExecutorState(ctx);
    const stage = executorState.roleSelectionStage;

    const goToRoleSelection = async (message: string) => {
      executorState.awaitingRoleSelection = true;
      executorState.role = undefined;
      executorState.roleSelectionStage = 'role';
      ctx.auth.user.executorKind = undefined;
      resetCitySelectionTracking(ctx);

      try {
        await ctx.answerCbQuery(message);
      } catch {
        // Ignore callback errors
      }

      await presentRoleSelection(ctx);
    };

    if (stage === 'city') {
      executorState.awaitingRoleSelection = true;
      executorState.role = undefined;
      executorState.roleSelectionStage = 'specialization';
      ctx.auth.user.executorKind = undefined;
      resetCitySelectionTracking(ctx);

      try {
        await ctx.answerCbQuery('Вернёмся к выбору специализации.');
      } catch {
        // Ignore callback errors
      }

      await presentExecutorSpecialisationSelection(ctx);
      return;
    }

    if (stage === 'specialization') {
      await goToRoleSelection('Вернёмся к выбору роли.');
      return;
    }

    await goToRoleSelection('Вы на шаге выбора роли.');
  });

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
    const executorState = ensureExecutorState(ctx);
    executorState.awaitingRoleSelection = true;
    executorState.role = undefined;
    await presentRoleSelection(ctx);
  });
};

