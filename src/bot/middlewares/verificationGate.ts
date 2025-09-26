import { type MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { isExecutorVerified } from '../../db/verifications';
import { CITY_ACTION_PATTERN } from '../flows/common/citySelect';
import { startExecutorVerification } from '../flows/executor/verification';
import type { BotContext, ExecutorRole } from '../types';

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
    if (typeof callbackData === 'string' && CITY_ACTION_PATTERN.test(callbackData)) {
      await next();
      return;
    }
  }

  const message = ctx.message;
  const hasPhoto = message && 'photo' in message && Array.isArray(message.photo) && message.photo.length > 0;

  if (executorState?.status === 'collecting' && hasPhoto) {
    await next();
    return;
  }

  if (executorState?.status === 'collecting') {
    return;
  }

  await startExecutorVerification(ctx);
};
