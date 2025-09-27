import { type MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { isExecutorVerified } from '../../db/verifications';
import { CITY_ACTION_PATTERN } from '../flows/common/citySelect';
import {
  EXECUTOR_MENU_ACTION,
  EXECUTOR_MENU_CITY_ACTION,
  EXECUTOR_ORDERS_ACTION,
  EXECUTOR_SUBSCRIPTION_ACTION,
  EXECUTOR_SUPPORT_ACTION,
  EXECUTOR_VERIFICATION_ACTION,
  isExecutorMenuTextCommand,
} from '../flows/executor/menu';
import { startExecutorVerification } from '../flows/executor/verification';
import type { BotContext, ExecutorRole } from '../types';

const COLLECTING_SAFE_COMMANDS = new Set(['/start', '/menu', '/help']);
const COLLECTING_SAFE_CALLBACK_PREFIXES = ['role:'];
const COLLECTING_SAFE_CALLBACKS = new Set([
  EXECUTOR_MENU_ACTION,
  EXECUTOR_MENU_CITY_ACTION,
  EXECUTOR_ORDERS_ACTION,
  EXECUTOR_SUBSCRIPTION_ACTION,
  EXECUTOR_SUPPORT_ACTION,
  EXECUTOR_VERIFICATION_ACTION,
]);
const VERIFICATION_REMINDER_INTERVAL_MS = 60_000;

const resolveExecutorRole = (ctx: BotContext, fallback: ExecutorRole): ExecutorRole => {
  const sessionRole = ctx.session.executor?.role;
  if (sessionRole === 'courier' || sessionRole === 'driver') {
    return sessionRole;
  }

  return fallback;
};

export const ensureVerifiedExecutor: MiddlewareFn<BotContext> = async (ctx, next) => {
  const role = ctx.auth?.user.role;
  if (role !== 'courier' && role !== 'driver') {
    await next();
    return;
  }

  const telegramId = ctx.auth?.user.telegramId ?? ctx.from?.id;
  if (!telegramId) {
    await next();
    return;
  }

  const executorRole = resolveExecutorRole(ctx, role);

  try {
    const verified = await isExecutorVerified(telegramId, executorRole);
    if (verified) {
      await next();
      return;
    }
  } catch (error) {
    logger.error(
      { err: error, telegramId, executorRole },
      'Failed to check executor verification status',
    );
    await next();
    return;
  }

  const executorState = ctx.session.executor?.verification?.[executorRole];

  const callbackQuery = ctx.callbackQuery;
  if (callbackQuery && 'data' in callbackQuery) {
    const callbackData = callbackQuery.data;
    if (
      typeof callbackData === 'string' &&
      (callbackData.startsWith('mod:') || CITY_ACTION_PATTERN.test(callbackData))
    ) {
      await next();
      return;
    }
  }

  const message = ctx.message;
  const hasPhoto =
    message && 'photo' in message && Array.isArray(message.photo) && message.photo.length > 0;
  const messageText = message && 'text' in message ? message.text : undefined;

  const isSafeCollectingCallback =
    callbackQuery &&
    'data' in callbackQuery &&
    typeof callbackQuery.data === 'string' &&
    (COLLECTING_SAFE_CALLBACK_PREFIXES.some((prefix) => callbackQuery.data.startsWith(prefix)) ||
      COLLECTING_SAFE_CALLBACKS.has(callbackQuery.data));

  const isSafeCollectingCommand =
    typeof messageText === 'string' &&
    (COLLECTING_SAFE_COMMANDS.has(messageText) || isExecutorMenuTextCommand(messageText));

  if (executorState?.status === 'collecting' && hasPhoto) {
    await next();
    return;
  }

  if (executorState?.status === 'collecting' && (isSafeCollectingCommand || isSafeCollectingCallback)) {
    await next();
    return;
  }

  if (executorState?.status === 'collecting') {
    const now = Date.now();
    const lastReminderAt = executorState.lastReminderAt ?? 0;

    if (now - lastReminderAt >= VERIFICATION_REMINDER_INTERVAL_MS) {
      try {
        await ctx.reply('Жду две фотографии документов, чтобы продолжить.');
      } catch (error) {
        logger.debug({ err: error }, 'Failed to send verification reminder');
      }

      executorState.lastReminderAt = now;
    }

    return;
  }

  await startExecutorVerification(ctx);
};
