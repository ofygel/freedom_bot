import { Markup, Telegraf, Telegram } from 'telegraf';

import { getChannelBinding } from './bindings';
import { logger } from '../../config';
import { withTx } from '../../db/client';
import {
  lockOrderById,
  setOrderChannelMessageId,
  tryCancelOrder,
  tryClaimOrder,
} from '../../db/orders';
import type { OrderKind, OrderRecord } from '../../types';
import type { BotContext } from '../types';

export type PublishOrderStatus = 'published' | 'already_published' | 'missing_channel';

export interface PublishOrderResult {
  status: PublishOrderStatus;
  messageId?: number;
}

const ACCEPT_ACTION_PREFIX = 'order:accept';
const DECLINE_ACTION_PREFIX = 'order:decline';
const ACCEPT_ACTION_PATTERN = /^order:accept:(\d+)$/;
const DECLINE_ACTION_PATTERN = /^order:decline:(\d+)$/;

const formatOrderType = (kind: OrderKind): string =>
  kind === 'taxi' ? 'Такси' : 'Доставка';

const formatDistance = (distanceKm: number): string => {
  if (!Number.isFinite(distanceKm)) {
    return 'н/д';
  }

  if (distanceKm < 0.1) {
    return '<0.1';
  }

  return distanceKm.toFixed(1);
};

const formatPrice = (amount: number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;

export const buildOrderMessage = (order: OrderRecord): string => {
  const lines = [
    `🆕 Новый заказ (${formatOrderType(order.kind)})`,
    `#${order.id}`,
    '',
    `📍 Подача: ${order.pickup.address}`,
    `🎯 Назначение: ${order.dropoff.address}`,
    `📏 Расстояние: ${formatDistance(order.price.distanceKm)} км`,
    `💰 Стоимость: ${formatPrice(order.price.amount, order.price.currency)}`,
  ];

  if (order.clientPhone) {
    lines.push(`📞 Телефон: ${order.clientPhone}`);
  }

  const customerName = order.metadata?.customerName?.trim();
  if (customerName) {
    lines.push(`👤 Имя: ${customerName}`);
  }

  const username = order.metadata?.customerUsername?.trim();
  if (username) {
    lines.push(`🔗 Telegram: @${username}`);
  }

  if (order.metadata?.notes) {
    lines.push('', `📝 Комментарий: ${order.metadata.notes}`);
  }

  return lines.join('\n');
};

type OrderChannelStatus = 'pending' | 'claimed' | 'declined';

interface UserInfo {
  id?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

interface OrderDecisionInfo {
  moderator?: UserInfo;
  decidedAt: number;
}

interface OrderChannelState {
  orderId: number;
  chatId: number;
  messageId: number;
  baseText: string;
  status: OrderChannelStatus;
  renderedStatus?: 'claimed' | 'declined';
  decision?: OrderDecisionInfo;
}

const orderStates = new Map<number, OrderChannelState>();

const toUserInfo = (from?: BotContext['from']): UserInfo => ({
  id: from?.id,
  username: from?.username ?? undefined,
  firstName: from?.first_name ?? undefined,
  lastName: from?.last_name ?? undefined,
});

const formatUserInfo = (info?: UserInfo): string => {
  if (!info) {
    return 'неизвестный участник';
  }

  if (info.username) {
    return `@${info.username}`;
  }

  const fullName = [info.firstName, info.lastName]
    .filter((value) => Boolean(value && value.trim().length > 0))
    .join(' ')
    .trim();

  if (fullName) {
    return info.id ? `${fullName} (ID ${info.id})` : fullName;
  }

  return info.id ? `ID ${info.id}` : 'неизвестный участник';
};

const mapOrderStatus = (order: OrderRecord): OrderChannelStatus => {
  if (order.status === 'claimed') {
    return 'claimed';
  }

  if (order.status === 'cancelled') {
    return 'declined';
  }

  return 'pending';
};

const ensureOrderState = (
  orderId: number,
  chatId: number,
  messageId: number,
  order?: OrderRecord,
): OrderChannelState => {
  let existing = orderStates.get(orderId);
  if (!existing) {
    const baseText = order ? buildOrderMessage(order) : '';
    existing = {
      orderId,
      chatId,
      messageId,
      baseText,
      status: order ? mapOrderStatus(order) : 'pending',
    } satisfies OrderChannelState;
    orderStates.set(orderId, existing);
  } else {
    existing.chatId = chatId;
    existing.messageId = messageId;
    if (order) {
      existing.baseText = buildOrderMessage(order);
      existing.status = mapOrderStatus(order);
    }
  }

  return existing;
};

const buildDecisionSuffix = (state: OrderChannelState): string => {
  const moderatorLabel = formatUserInfo(state.decision?.moderator);

  if (state.status === 'claimed') {
    return `✅ Заказ принят: ${moderatorLabel}.`;
  }

  if (state.status === 'declined') {
    return `❌ Заказ недоступен. Отметил ${moderatorLabel}.`;
  }

  return '';
};

const updateOrderMessage = async (telegram: Telegram, state: OrderChannelState): Promise<void> => {
  const suffix = buildDecisionSuffix(state);
  const text = suffix ? `${state.baseText}\n\n${suffix}`.trim() : state.baseText;

  try {
    await telegram.editMessageText(state.chatId, state.messageId, undefined, text, {
      reply_markup: suffix ? { inline_keyboard: [] } : undefined,
    });
    state.renderedStatus = state.status === 'pending' ? undefined : state.status;
  } catch (error) {
    logger.warn(
      { err: error, orderId: state.orderId, chatId: state.chatId, messageId: state.messageId },
      'Failed to update order message in drivers channel',
    );
  }
};

const ensureMessageReflectsState = async (
  telegram: Telegram,
  state: OrderChannelState,
): Promise<void> => {
  if (state.status === 'pending') {
    return;
  }

  if (state.renderedStatus === state.status) {
    return;
  }

  await updateOrderMessage(telegram, state);
};

const buildAlreadyProcessedResponse = (state: OrderChannelState): string => {
  if (state.status === 'claimed') {
    const moderatorLabel = formatUserInfo(state.decision?.moderator);
    return `Заказ уже принят ${moderatorLabel}.`;
  }

  if (state.status === 'declined') {
    const moderatorLabel = formatUserInfo(state.decision?.moderator);
    return `Заказ уже снят с публикации ${moderatorLabel}.`;
  }

  return 'Заказ уже обработан.';
};

const buildActionKeyboard = (orderId: number) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('✅ Беру заказ', `${ACCEPT_ACTION_PREFIX}:${orderId}`)],
    [Markup.button.callback('❌ Недоступен', `${DECLINE_ACTION_PREFIX}:${orderId}`)],
  ]);

export const publishOrderToDriversChannel = async (
  telegram: Telegram,
  orderId: number,
): Promise<PublishOrderResult> => {
  const binding = await getChannelBinding('drivers');
  if (!binding) {
    logger.warn({ orderId }, 'Drivers channel is not configured, skipping publish');
    return { status: 'missing_channel' } satisfies PublishOrderResult;
  }

  try {
    return await withTx(
      async (client) => {
        const order = await lockOrderById(client, orderId);
        if (!order) {
          throw new Error(`Order ${orderId} not found`);
        }

        const messageText = buildOrderMessage(order);

        if (order.channelMessageId) {
          orderStates.set(order.id, {
            orderId: order.id,
            chatId: binding.chatId,
            messageId: order.channelMessageId,
            baseText: messageText,
            status: mapOrderStatus(order),
          });
          return {
            status: 'already_published',
            messageId: order.channelMessageId,
          } satisfies PublishOrderResult;
        }

        const keyboard = buildActionKeyboard(order.id);
        const message = await telegram.sendMessage(binding.chatId, messageText, {
          reply_markup: keyboard.reply_markup,
        });

        await setOrderChannelMessageId(client, order.id, message.message_id);

        orderStates.set(order.id, {
          orderId: order.id,
          chatId: binding.chatId,
          messageId: message.message_id,
          baseText: messageText,
          status: 'pending',
        });

        return {
          status: 'published',
          messageId: message.message_id,
        } satisfies PublishOrderResult;
      },
      { isolationLevel: 'serializable' },
    );
  } catch (error) {
    logger.error({ err: error, orderId }, 'Failed to publish order to drivers channel');
    throw error;
  }
};

type OrderActionOutcome =
  | { outcome: 'not_found' }
  | { outcome: 'already_processed'; order: OrderRecord }
  | { outcome: 'claimed'; order: OrderRecord }
  | { outcome: 'declined'; order: OrderRecord };

const processOrderAction = async (
  orderId: number,
  decision: 'accept' | 'decline',
): Promise<OrderActionOutcome> =>
  withTx(
    async (client) => {
      const order = await lockOrderById(client, orderId);
      if (!order) {
        return { outcome: 'not_found' } as const;
      }

      if (decision === 'accept') {
        if (order.status !== 'new') {
          return { outcome: 'already_processed', order } as const;
        }

        const updated = await tryClaimOrder(client, orderId);
        if (!updated) {
          return { outcome: 'already_processed', order } as const;
        }

        return { outcome: 'claimed', order: updated } as const;
      }

      if (order.status !== 'new') {
        return { outcome: 'already_processed', order } as const;
      }

      const cancelled = await tryCancelOrder(client, orderId);
      if (!cancelled) {
        return { outcome: 'already_processed', order } as const;
      }

      return { outcome: 'declined', order: cancelled } as const;
    },
    { isolationLevel: 'serializable' },
  );

const handleOrderDecision = async (
  ctx: BotContext,
  orderId: number,
  decision: 'accept' | 'decline',
): Promise<void> => {
  const message = ctx.callbackQuery?.message;
  if (!message || !('message_id' in message) || !message.chat) {
    await ctx.answerCbQuery('Не удалось обработать действие.');
    return;
  }

  const chatId = message.chat.id;
  const messageId = message.message_id;

  let result: OrderActionOutcome;
  try {
    result = await processOrderAction(orderId, decision);
  } catch (error) {
    logger.error({ err: error, orderId }, 'Failed to apply order channel decision');
    await ctx.answerCbQuery('Не удалось обработать действие. Попробуйте позже.');
    return;
  }

  if (result.outcome === 'not_found') {
    await ctx.answerCbQuery('Заказ не найден или уже удалён.');
    return;
  }

  const state = ensureOrderState(orderId, chatId, messageId, result.order);

  switch (result.outcome) {
    case 'already_processed': {
      await ensureMessageReflectsState(ctx.telegram, state);
      await ctx.answerCbQuery(buildAlreadyProcessedResponse(state));
      return;
    }
    case 'claimed': {
      state.status = 'claimed';
      state.decision = {
        moderator: toUserInfo(ctx.from),
        decidedAt: Date.now(),
      };
      await updateOrderMessage(ctx.telegram, state);
      await ctx.answerCbQuery('Вы взяли этот заказ.');
      return;
    }
    case 'declined': {
      state.status = 'declined';
      state.decision = {
        moderator: toUserInfo(ctx.from),
        decidedAt: Date.now(),
      };
      await updateOrderMessage(ctx.telegram, state);
      await ctx.answerCbQuery('Заказ отмечен как недоступный.');
      return;
    }
    default:
      return;
  }
};

export const registerOrdersChannel = (bot: Telegraf<BotContext>): void => {
  bot.action(ACCEPT_ACTION_PATTERN, async (ctx) => {
    const match = ctx.match as RegExpMatchArray | undefined;
    const idText = match?.[1];
    const orderId = idText ? Number.parseInt(idText, 10) : NaN;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.answerCbQuery('Некорректный идентификатор заказа.');
      return;
    }

    await handleOrderDecision(ctx, orderId, 'accept');
  });

  bot.action(DECLINE_ACTION_PATTERN, async (ctx) => {
    const match = ctx.match as RegExpMatchArray | undefined;
    const idText = match?.[1];
    const orderId = idText ? Number.parseInt(idText, 10) : NaN;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.answerCbQuery('Некорректный идентификатор заказа.');
      return;
    }

    await handleOrderDecision(ctx, orderId, 'decline');
  });
};
