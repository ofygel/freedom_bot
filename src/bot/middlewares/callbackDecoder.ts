import type { MiddlewareFn } from 'telegraf';

import { config, logger } from '../../config';
import { withLatencyLog } from '../../metrics/latency';
import { sampleLatency } from '../../metrics/agg';
import type { BotContext } from '../types';
import { renderMenuFor } from '../ui/menus';
import {
  tryDecodeCallbackData,
  verifyCallbackData,
  verifyCallbackForUser,
} from '../services/callbackTokens';
import { copy } from '../copy';

const resolveSecret = (): string => config.bot.callbackSignSecret ?? config.bot.token;

export const callbackDecoder = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  const query = ctx.callbackQuery;
  if (!query || !('data' in query) || typeof query.data !== 'string') {
    await next();
    return;
  }

  const data = query.data;

  const decoded = tryDecodeCallbackData(data);
  if (!decoded.ok) {
    await next();
    return;
  }

  const secret = resolveSecret();
  const requiresUserBinding = Boolean(decoded.wrapped.user || decoded.wrapped.nonce);
  const isValid = requiresUserBinding
    ? verifyCallbackForUser(ctx, decoded.wrapped, secret)
    : verifyCallbackData(decoded.wrapped, secret);

  if (!isValid) {
    if (typeof ctx.answerCbQuery === 'function') {
      try {
        await ctx.answerCbQuery(copy.expiredButton, { show_alert: false });
      } catch (error) {
        logger.debug({ err: error }, 'Failed to answer callback query in callbackDecoder');
      }
    }

    try {
      await renderMenuFor(ctx);
    } catch (error) {
      logger.debug({ err: error }, 'Failed to render menu after invalid callback payload');
    }

    return;
  }

  const state = ctx.state as Record<string, unknown>;
  state.callbackPayload = decoded.wrapped;
  (query as { data?: string }).data = decoded.wrapped.raw;

  const startedAt = Date.now();
  try {
    await withLatencyLog(`callback:${decoded.wrapped.raw}`, async () => {
      await next();
    });
  } finally {
    sampleLatency('callback', Date.now() - startedAt);
  }
};

