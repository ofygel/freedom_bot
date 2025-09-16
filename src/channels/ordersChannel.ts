import type { Telegram } from 'telegraf';

import { logger } from '../config';
import { withTx } from '../db/client';
import { lockOrderById, setOrderChannelMessageId } from '../db/orders';
import type { OrderKind, OrderRecord } from '../types';
import { getChannelBinding } from './index';

export type PublishOrderStatus = 'published' | 'already_published' | 'missing_channel';

export interface PublishOrderResult {
  status: PublishOrderStatus;
  messageId?: number;
}

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

const buildOrderMessage = (order: OrderRecord): string => {
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

export const publishOrderToDriversChannel = async (
  telegram: Telegram,
  orderId: number,
): Promise<PublishOrderResult> => {
  const binding = await getChannelBinding('drivers');
  if (!binding) {
    logger.warn({ orderId }, 'Drivers channel is not configured, skipping publish');
    return { status: 'missing_channel' };
  }

  try {
    return await withTx(
      async (client) => {
        const order = await lockOrderById(client, orderId);
        if (!order) {
          throw new Error(`Order ${orderId} not found`);
        }

        if (order.channelMessageId) {
          return { status: 'already_published', messageId: order.channelMessageId };
        }

        const messageText = buildOrderMessage(order);
        const message = await telegram.sendMessage(binding.chatId, messageText);

        await setOrderChannelMessageId(client, order.id, message.message_id);

        return { status: 'published', messageId: message.message_id } satisfies PublishOrderResult;
      },
      { isolationLevel: 'serializable' },
    );
  } catch (error) {
    logger.error({ err: error, orderId }, 'Failed to publish order to drivers channel');
    throw error;
  }
};

export { buildOrderMessage };
