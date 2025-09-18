import { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import {
  cancelClientOrder,
  getOrderWithExecutorById,
  listClientOrders,
} from '../../../db/orders';
import { handleClientOrderCancellation } from '../../channels/ordersChannel';
import { buildInlineKeyboard, mergeInlineKeyboards } from '../../keyboards/common';
import { buildOrderLocationsKeyboard } from '../../keyboards/orders';
import { ensurePrivateCallback, isPrivateChat } from '../../services/access';
import { formatDistance, formatEtaMinutes, formatPriceAmount } from '../../services/pricing';
import type { BotContext } from '../../types';
import type { OrderStatus, OrderWithExecutor } from '../../../types';
import { ui } from '../../ui';
import { CLIENT_MENU_ACTION } from './menu';
import {
  CLIENT_CANCEL_ORDER_ACTION_PATTERN,
  CLIENT_CANCEL_ORDER_ACTION_PREFIX,
  CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PATTERN,
  CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PREFIX,
  CLIENT_ORDERS_ACTION,
  CLIENT_VIEW_ORDER_ACTION_PATTERN,
  CLIENT_VIEW_ORDER_ACTION_PREFIX,
} from './orderActions';

const CLIENT_ORDERS_LIST_STEP_ID = 'client:orders:list';
const CLIENT_ORDER_DETAIL_STEP_ID = 'client:orders:detail';

const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['open', 'claimed'];

const ORDER_KIND_ICONS: Record<OrderWithExecutor['kind'], string> = {
  taxi: '🚕',
  delivery: '🚚',
};

const ORDER_KIND_LABELS: Record<OrderWithExecutor['kind'], string> = {
  taxi: 'Такси',
  delivery: 'Доставка',
};

const ORDER_STATUS_TEXT: Record<OrderStatus, { short: string; full: string }> = {
  open: { short: 'ожидает исполнителя', full: 'Ожидает исполнителя' },
  claimed: { short: 'в работе', full: 'Выполняется исполнителем' },
  cancelled: { short: 'отменён', full: 'Заказ отменён' },
  done: { short: 'завершён', full: 'Заказ выполнен' },
};

interface OrderDetailOptions {
  confirmCancellation?: boolean;
}

const formatStatusLabel = (status: OrderStatus): { short: string; full: string } =>
  ORDER_STATUS_TEXT[status] ?? { short: status, full: status };

const formatFullName = (first?: string, last?: string): string | undefined => {
  const full = [first?.trim(), last?.trim()].filter(Boolean).join(' ').trim();
  return full || undefined;
};

const formatExecutorLabel = (order: OrderWithExecutor): string => {
  const executor = order.executor;
  if (!executor) {
    return typeof order.claimedBy === 'number' ? `ID ${order.claimedBy}` : 'неизвестно';
  }

  const fullName = formatFullName(executor.firstName, executor.lastName);
  if (fullName && executor.username) {
    return `${fullName} (@${executor.username})`;
  }

  if (fullName) {
    return fullName;
  }

  if (executor.username) {
    return `@${executor.username}`;
  }

  return `ID ${executor.telegramId}`;
};

const normalisePhoneNumber = (phone: string): string => phone.replace(/[\s()-]/g, '');

const buildContactKeyboard = (order: OrderWithExecutor): InlineKeyboardMarkup | undefined => {
  if (order.status !== 'claimed') {
    return undefined;
  }

  const executor = order.executor;
  if (!executor) {
    return undefined;
  }

  const rows: { label: string; url: string }[][] = [];
  const phone = executor.phone?.trim();
  if (phone) {
    rows.push([{ label: '📞 Позвонить', url: `tel:${normalisePhoneNumber(phone)}` }]);
  }

  const chatUrl = executor.username
    ? `https://t.me/${executor.username}`
    : executor.telegramId
    ? `tg://user?id=${executor.telegramId}`
    : undefined;
  if (chatUrl) {
    rows.push([{ label: '💬 Написать в Telegram', url: chatUrl }]);
  }

  if (rows.length === 0) {
    return undefined;
  }

  return buildInlineKeyboard(rows);
};

const buildControlKeyboard = (
  order: OrderWithExecutor,
  options: OrderDetailOptions,
): InlineKeyboardMarkup => {
  const rows: { label: string; action: string }[][] = [];

  if (order.status === 'open' || order.status === 'claimed') {
    if (options.confirmCancellation) {
      rows.push([
        {
          label: '✅ Подтвердить отмену',
          action: `${CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PREFIX}:${order.id}`,
        },
      ]);
      rows.push([
        { label: '↩️ Назад', action: `${CLIENT_VIEW_ORDER_ACTION_PREFIX}:${order.id}` },
      ]);
    } else {
      rows.push([
        { label: '❌ Отменить заказ', action: `${CLIENT_CANCEL_ORDER_ACTION_PREFIX}:${order.id}` },
      ]);
    }
  }

  rows.push([{ label: '📋 Все заказы', action: CLIENT_ORDERS_ACTION }]);

  return buildInlineKeyboard(rows);
};

const buildOrderDetailKeyboard = (
  order: OrderWithExecutor,
  options: OrderDetailOptions,
): InlineKeyboardMarkup | undefined => {
  const locationsKeyboard = buildOrderLocationsKeyboard(order.pickup, order.dropoff);
  const contactKeyboard = buildContactKeyboard(order);
  const controlsKeyboard = buildControlKeyboard(order, options);

  return mergeInlineKeyboards(locationsKeyboard, contactKeyboard, controlsKeyboard);
};

const buildOrderDetailText = (
  order: OrderWithExecutor,
  options: OrderDetailOptions,
): string => {
  const status = formatStatusLabel(order.status);
  const headerIcon = ORDER_KIND_ICONS[order.kind] ?? '📦';
  const kindLabel = ORDER_KIND_LABELS[order.kind] ?? 'Заказ';
  const lines: string[] = [];

  lines.push(`${headerIcon} ${kindLabel} №${order.shortId}`);
  lines.push(`Статус: ${status.full}.`);
  lines.push('');
  lines.push(`📍 Подача: ${order.pickup.address}`);
  lines.push(`🎯 Назначение: ${order.dropoff.address}`);
  lines.push(`📏 Расстояние: ${formatDistance(order.price.distanceKm)} км`);
  lines.push(`⏱️ В пути: ≈${formatEtaMinutes(order.price.etaMinutes)} мин`);
  lines.push(`💰 Стоимость: ${formatPriceAmount(order.price.amount, order.price.currency)}`);

  if (order.clientComment?.trim()) {
    lines.push('', `📝 Комментарий: ${order.clientComment.trim()}`);
  }

  if (order.status === 'claimed') {
    lines.push('');
    lines.push(`👤 Исполнитель: ${formatExecutorLabel(order)}`);
    if (order.executor?.phone?.trim()) {
      lines.push(`📞 Телефон: ${order.executor.phone.trim()}`);
    }
    if (order.executor?.username?.trim()) {
      lines.push(`🔗 Telegram: @${order.executor.username.trim()}`);
    }
  }

  if (options.confirmCancellation) {
    lines.push('');
    lines.push('⚠️ Подтвердите отмену заказа. После отмены он станет недоступен исполнителям.');
  }

  lines.push('');
  lines.push('Используйте кнопки ниже, чтобы управлять заказом.');

  return lines.join('\n');
};

const renderOrderDetail = async (
  ctx: BotContext,
  order: OrderWithExecutor,
  options: OrderDetailOptions = {},
): Promise<void> => {
  const text = buildOrderDetailText(order, options);
  const keyboard = buildOrderDetailKeyboard(order, options);

  await ui.step(ctx, {
    id: CLIENT_ORDER_DETAIL_STEP_ID,
    text,
    keyboard,
    homeAction: CLIENT_MENU_ACTION,
  });
};

const buildOrdersListText = (orders: OrderWithExecutor[]): string => {
  if (orders.length === 0) {
    return [
      '📋 Активных заказов пока нет.',
      '',
      'Оформите новый заказ через меню клиента.',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`📋 Ваши активные заказы (${orders.length})`);
  lines.push('Нажмите на заказ, чтобы открыть подробности.');
  lines.push('');

  for (const order of orders) {
    const status = formatStatusLabel(order.status);
    const icon = ORDER_KIND_ICONS[order.kind] ?? '📦';
    lines.push(`• ${icon} №${order.shortId} — ${status.full}`);
  }

  lines.push('');
  lines.push('Используйте кнопки ниже, чтобы управлять заказами.');

  return lines.join('\n');
};

const buildOrdersListKeyboard = (orders: OrderWithExecutor[]): InlineKeyboardMarkup => {
  const rows: { label: string; action: string }[][] = orders.map((order) => [
    {
      label: `${ORDER_KIND_ICONS[order.kind] ?? '📦'} №${order.shortId}`,
      action: `${CLIENT_VIEW_ORDER_ACTION_PREFIX}:${order.id}`,
    },
  ]);

  rows.push([{ label: '🔄 Обновить список', action: CLIENT_ORDERS_ACTION }]);

  return buildInlineKeyboard(rows);
};

const renderOrdersList = async (
  ctx: BotContext,
  orders?: OrderWithExecutor[],
): Promise<OrderWithExecutor[]> => {
  const items = orders ?? (await listClientOrders(ctx.auth.user.telegramId, {
    statuses: ACTIVE_ORDER_STATUSES,
    limit: 10,
  }));

  const text = buildOrdersListText(items);
  const keyboard = buildOrdersListKeyboard(items);

  await ui.step(ctx, {
    id: CLIENT_ORDERS_LIST_STEP_ID,
    text,
    keyboard,
    homeAction: CLIENT_MENU_ACTION,
  });

  return items;
};

const showClientOrderDetail = async (
  ctx: BotContext,
  orderId: number,
  options: OrderDetailOptions = {},
): Promise<OrderWithExecutor | null> => {
  const order = await getOrderWithExecutorById(orderId);
  if (!order || order.clientId !== ctx.auth.user.telegramId) {
    await ctx.answerCbQuery('Заказ недоступен.');
    return null;
  }

  await renderOrderDetail(ctx, order, options);
  return order;
};

const confirmClientOrderCancellation = async (
  ctx: BotContext,
  orderId: number,
): Promise<void> => {
  const clientId = ctx.auth.user.telegramId;
  const cancelled = await cancelClientOrder(orderId, clientId);

  if (!cancelled) {
    await ctx.answerCbQuery('Не удалось отменить заказ. Возможно, он уже обработан.');
    const current = await getOrderWithExecutorById(orderId);
    if (current && current.clientId === clientId) {
      await renderOrderDetail(ctx, current);
    }
    await renderOrdersList(ctx);
    return;
  }

  try {
    await handleClientOrderCancellation(ctx.telegram, cancelled);
  } catch (error) {
    // Ошибки при уведомлении исполнителя не должны прерывать пользовательский поток.
  }

  await ctx.answerCbQuery('Заказ отменён.');
  await renderOrderDetail(ctx, cancelled);
  await renderOrdersList(ctx);
};

export const registerClientOrdersFlow = (bot: Telegraf<BotContext>): void => {
  bot.action(CLIENT_ORDERS_ACTION, async (ctx) => {
    if (!(await ensurePrivateCallback(ctx))) {
      return;
    }

    await renderOrdersList(ctx);
  });

  bot.action(CLIENT_VIEW_ORDER_ACTION_PATTERN, async (ctx) => {
    if (!(await ensurePrivateCallback(ctx))) {
      return;
    }

    const match = ctx.match as RegExpMatchArray | undefined;
    const idText = match?.[1];
    const orderId = idText ? Number.parseInt(idText, 10) : NaN;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.answerCbQuery('Некорректный идентификатор заказа.');
      return;
    }

    await showClientOrderDetail(ctx, orderId);
  });

  bot.action(CLIENT_CANCEL_ORDER_ACTION_PATTERN, async (ctx) => {
    if (!(await ensurePrivateCallback(ctx))) {
      return;
    }

    const match = ctx.match as RegExpMatchArray | undefined;
    const idText = match?.[1];
    const orderId = idText ? Number.parseInt(idText, 10) : NaN;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.answerCbQuery('Некорректный идентификатор заказа.');
      return;
    }

    await showClientOrderDetail(ctx, orderId, { confirmCancellation: true });
  });

  bot.action(CLIENT_CONFIRM_CANCEL_ORDER_ACTION_PATTERN, async (ctx) => {
    if (!(await ensurePrivateCallback(ctx))) {
      return;
    }

    const match = ctx.match as RegExpMatchArray | undefined;
    const idText = match?.[1];
    const orderId = idText ? Number.parseInt(idText, 10) : NaN;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      await ctx.answerCbQuery('Некорректный идентификатор заказа.');
      return;
    }

    await confirmClientOrderCancellation(ctx, orderId);
  });

  bot.command('orders', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      return;
    }

    await renderOrdersList(ctx);
  });
};
