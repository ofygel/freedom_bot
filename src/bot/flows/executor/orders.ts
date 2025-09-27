import { Markup, Telegraf } from 'telegraf';

import { config, logger } from '../../../config';
import { getChannelBinding } from '../../channels/bindings';
import { findActiveSubscriptionForUser } from '../../../db/subscriptions';
import type { BotContext, ExecutorFlowState } from '../../types';
import { ui } from '../../ui';
import {
  EXECUTOR_MENU_ACTION,
  EXECUTOR_MENU_TEXT_LABELS,
  EXECUTOR_ORDERS_ACTION,
  ensureExecutorState,
  requireExecutorRole,
  showExecutorMenu,
} from './menu';
import { copy, getExecutorRoleCopy } from '../../copy';

const ORDERS_LINK_STEP_ID = 'executor:orders:link';

export const EXECUTOR_SUBSCRIPTION_REQUIRED_MESSAGE =
  'Подписка на канал заказов не активна. Оформите подписку через меню, чтобы получить доступ.';

const EXECUTOR_ORDERS_INVITE_FAILURE_PROMPT =
  'Не удалось получить ссылку на канал заказов. Попробуйте позже или обратитесь в поддержку через меню.';

const formatDateTime = (value: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: config.timezone,
  }).format(value);

type InviteSource = 'generated' | 'cached' | 'config' | 'none';

interface InviteResolutionResult {
  link?: string;
  expiresAt?: Date;
  source: InviteSource;
}

export const resolveInviteLink = async (
  ctx: BotContext,
  state: ExecutorFlowState,
): Promise<InviteResolutionResult> => {
  requireExecutorRole(state);
  const subscription = state.subscription;
  const cachedLink = subscription.lastInviteLink;
  const fallbackInvite = config.subscriptions.payment.driversChannelInvite;

  const binding = await getChannelBinding('drivers');
  if (!binding) {
    if (cachedLink) {
      logger.warn(
        { telegramId: ctx.auth.user.telegramId },
        'Drivers channel binding missing, using cached invite link',
      );
      return { link: cachedLink, source: 'cached' } satisfies InviteResolutionResult;
    }

    if (fallbackInvite) {
      logger.error(
        { telegramId: ctx.auth.user.telegramId },
        'Drivers channel binding missing, using configured invite link',
      );
      return { link: fallbackInvite, source: 'config' } satisfies InviteResolutionResult;
    }

    logger.error(
      { telegramId: ctx.auth.user.telegramId },
      'Drivers channel binding missing and no invite fallback available',
    );
    return { source: 'none' } satisfies InviteResolutionResult;
  }

  let expiresAt: Date | undefined;
  try {
    const activeSubscription = await findActiveSubscriptionForUser(
      binding.chatId,
      ctx.auth.user.telegramId,
    );
    expiresAt = activeSubscription?.expiresAt ?? activeSubscription?.nextBillingAt ?? undefined;
  } catch (error) {
    logger.error(
      { err: error, chatId: binding.chatId, telegramId: ctx.auth.user.telegramId },
      'Failed to resolve active subscription before issuing invite link',
    );

    const failureMarker = new Date(0);
    return { expiresAt: failureMarker, source: 'none' } satisfies InviteResolutionResult;
  }

  try {
    const options: { name: string; member_limit?: number; expire_date?: number } = {
      name: `Manual invite ${ctx.auth.user.telegramId}`,
      member_limit: 1,
    };
    if (expiresAt) {
      const expireSeconds = Math.floor(expiresAt.getTime() / 1000);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (expireSeconds > nowSeconds) {
        options.expire_date = expireSeconds;
      }
    }

    const invite = await ctx.telegram.createChatInviteLink(binding.chatId, options);
    if (invite.invite_link) {
      return {
        link: invite.invite_link,
        expiresAt,
        source: 'generated',
      } satisfies InviteResolutionResult;
    }
  } catch (error) {
    logger.error(
      { err: error, chatId: binding.chatId, telegramId: ctx.auth.user.telegramId },
      'Failed to create invite link for executor request',
    );
  }

  if (cachedLink) {
    logger.warn(
      { telegramId: ctx.auth.user.telegramId },
      'Falling back to cached invite link after generation failure',
    );
    return { link: cachedLink, source: 'cached' } satisfies InviteResolutionResult;
  }

  if (fallbackInvite) {
    logger.warn(
      { telegramId: ctx.auth.user.telegramId },
      'Falling back to configured invite link after generation failure',
    );
    return { link: fallbackInvite, source: 'config' } satisfies InviteResolutionResult;
  }

  return { source: 'none' } satisfies InviteResolutionResult;
};

const buildInviteMessage = (
  state: ExecutorFlowState,
  expiresAt?: Date,
): string => {
  const role = requireExecutorRole(state);
  const copy = getExecutorRoleCopy(role);
  const lines = [
    `Нажмите кнопку ниже, чтобы перейти в канал ${copy.pluralGenitive}.`,
    expiresAt ? `Ссылка действует до ${formatDateTime(expiresAt)}.` : undefined,
    'Если ссылка перестанет работать, запросите новую через это меню или свяжитесь с поддержкой.',
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  return lines.join('\n');
};

export const sendInviteLink = async (
  ctx: BotContext,
  state: ExecutorFlowState,
  link: string,
  expiresAt?: Date,
): Promise<void> => {
  requireExecutorRole(state);
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('Перейти к заказам', link)],
  ]).reply_markup;

  await ui.step(ctx, {
    id: ORDERS_LINK_STEP_ID,
    text: buildInviteMessage(state, expiresAt),
    keyboard,
    homeAction: EXECUTOR_MENU_ACTION,
  });
};

export const processOrdersRequest = async (ctx: BotContext): Promise<void> => {
  const state = ensureExecutorState(ctx);
  if (!state.role) {
    return;
  }
  if (!ctx.auth.executor.hasActiveSubscription) {
    state.subscription.status = 'idle';
    state.subscription.selectedPeriodId = undefined;
    state.subscription.pendingPaymentId = undefined;
    await ui.step(ctx, {
      id: ORDERS_LINK_STEP_ID,
      text: EXECUTOR_SUBSCRIPTION_REQUIRED_MESSAGE,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    await showExecutorMenu(ctx, { skipAccessCheck: true });
    return;
  }

  const resolution = await resolveInviteLink(ctx, state);
  if (!resolution.link) {
    const isResolutionFailure =
      resolution.source === 'none' &&
      resolution.expiresAt instanceof Date &&
      resolution.expiresAt.getTime() === 0;

    const text = isResolutionFailure
      ? `${copy.serviceUnavailable}\n\n${EXECUTOR_ORDERS_INVITE_FAILURE_PROMPT}`
      : EXECUTOR_ORDERS_INVITE_FAILURE_PROMPT;

    await ui.step(ctx, {
      id: ORDERS_LINK_STEP_ID,
      text,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  state.subscription.lastInviteLink = resolution.link;
  state.subscription.lastIssuedAt = Date.now();
  state.subscription.status = 'idle';
  state.subscription.selectedPeriodId = undefined;
  state.subscription.pendingPaymentId = undefined;
  state.subscription.moderationChatId = undefined;
  state.subscription.moderationMessageId = undefined;

  await sendInviteLink(ctx, state, resolution.link, resolution.expiresAt);
  await showExecutorMenu(ctx, { skipAccessCheck: true });
};

export const registerExecutorOrders = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_ORDERS_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    await ctx.answerCbQuery('Готовим ссылку…');
    await processOrdersRequest(ctx);
  });

  bot.hears(EXECUTOR_MENU_TEXT_LABELS.orders, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return;
    }

    await processOrdersRequest(ctx);
  });
};
