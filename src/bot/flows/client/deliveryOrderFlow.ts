import { Markup, Telegraf } from 'telegraf';

import { publishOrderToDriversChannel, type PublishOrderStatus } from '../../../channels/ordersChannel';
import { logger } from '../../../config';
import { createOrder } from '../../../db/orders';
import { geocodeAddress, type GeocodingResult } from '../../../services/geocoding';
import { estimateDeliveryPrice } from '../../../services/pricing';
import type { BotContext, ClientOrderDraftState } from '../../types';
import type { OrderLocation, OrderRecord } from '../../../types';

export const START_DELIVERY_ORDER_ACTION = 'client:order:delivery:start';
const CONFIRM_DELIVERY_ORDER_ACTION = 'client:order:delivery:confirm';
const CANCEL_DELIVERY_ORDER_ACTION = 'client:order:delivery:cancel';

const ensurePrivateChat = (ctx: BotContext): boolean => ctx.chat?.type === 'private';

const getDraft = (ctx: BotContext): ClientOrderDraftState => ctx.session.client.delivery;

const resetDraft = (draft: ClientOrderDraftState): void => {
  draft.stage = 'idle';
  draft.pickup = undefined;
  draft.dropoff = undefined;
  draft.price = undefined;
  draft.confirmationMessageId = undefined;
};

const toOrderLocation = (location: GeocodingResult): OrderLocation => ({
  query: location.query,
  address: location.address,
  latitude: location.latitude,
  longitude: location.longitude,
});

const formatPrice = (amount: number, currency: string): string =>
  `${new Intl.NumberFormat('ru-RU').format(amount)} ${currency}`;

const formatDistance = (distanceKm: number): string => {
  if (!Number.isFinite(distanceKm)) {
    return 'н/д';
  }

  if (distanceKm < 0.1) {
    return '<0.1';
  }

  return distanceKm.toFixed(1);
};

const buildSummary = (draft: ClientOrderDraftState): string => {
  if (!draft.pickup || !draft.dropoff || !draft.price) {
    throw new Error('Cannot build summary for incomplete delivery order draft');
  }

  const lines = [
    '🚚 Доставка курьером',
    '',
    `📦 Забор: ${draft.pickup.address}`,
    `📮 Доставка: ${draft.dropoff.address}`,
    `📏 Расстояние: ${formatDistance(draft.price.distanceKm)} км`,
    `💰 Оценка стоимости: ${formatPrice(draft.price.amount, draft.price.currency)}`,
    '',
    'Подтвердите заказ или отмените оформление.',
  ];

  return lines.join('\n');
};

const requestPickupAddress = async (ctx: BotContext): Promise<void> => {
  const prompt = await ctx.reply(
    [
      'Укажите адрес, откуда курьер заберёт посылку.',
      'Например: «Абылайхана 10, офис 5».',
    ].join('\n'),
  );
  ctx.session.ephemeralMessages.push(prompt.message_id);
};

const requestDropoffAddress = async (ctx: BotContext, pickup: OrderLocation): Promise<void> => {
  const prompt = await ctx.reply(
    [`Адрес забора: ${pickup.address}.`, 'Теперь укажите адрес доставки.'].join('\n'),
  );
  ctx.session.ephemeralMessages.push(prompt.message_id);
};

const handleGeocodingFailure = async (ctx: BotContext): Promise<void> => {
  const message = await ctx.reply(
    'Не удалось распознать адрес. Пожалуйста, уточните формулировку и попробуйте снова.',
  );
  ctx.session.ephemeralMessages.push(message.message_id);
};

const applyPickupAddress = async (ctx: BotContext, draft: ClientOrderDraftState, text: string) => {
  const result = await geocodeAddress(text);
  if (!result) {
    await handleGeocodingFailure(ctx);
    return;
  }

  draft.pickup = toOrderLocation(result);
  draft.stage = 'collectingDropoff';

  await requestDropoffAddress(ctx, draft.pickup);
};

const applyDropoffAddress = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  text: string,
): Promise<void> => {
  const result = await geocodeAddress(text);
  if (!result) {
    await handleGeocodingFailure(ctx);
    return;
  }

  draft.dropoff = toOrderLocation(result);

  if (!draft.pickup) {
    logger.warn('Delivery order draft is missing pickup after dropoff geocode');
    draft.stage = 'idle';
    return;
  }

  draft.price = estimateDeliveryPrice(draft.pickup, draft.dropoff);
  draft.stage = 'awaitingConfirmation';

  const summary = buildSummary(draft);
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✅ Подтвердить', CONFIRM_DELIVERY_ORDER_ACTION)],
    [Markup.button.callback('❌ Отменить', CANCEL_DELIVERY_ORDER_ACTION)],
  ]);
  const message = await ctx.reply(summary, keyboard);
  draft.confirmationMessageId = message.message_id;
};

const removeConfirmationKeyboard = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
): Promise<void> => {
  if (!draft.confirmationMessageId || !ctx.chat) {
    return;
  }

  try {
    await ctx.telegram.editMessageReplyMarkup(
      ctx.chat.id,
      draft.confirmationMessageId,
      undefined,
      undefined,
    );
  } catch (error) {
    logger.debug(
      { err: error, chatId: ctx.chat.id, messageId: draft.confirmationMessageId },
      'Failed to clear confirmation keyboard for delivery order',
    );
  }
};

const cancelOrderDraft = async (ctx: BotContext, draft: ClientOrderDraftState): Promise<void> => {
  await removeConfirmationKeyboard(ctx, draft);
  resetDraft(draft);

  const message = await ctx.reply('Оформление доставки отменено.');
  ctx.session.ephemeralMessages.push(message.message_id);
};

type CompletedDeliveryDraft = ClientOrderDraftState &
  Required<Pick<ClientOrderDraftState, 'pickup' | 'dropoff' | 'price'>>;

const ensureCompletion = (draft: ClientOrderDraftState): draft is CompletedDeliveryDraft =>
  Boolean(draft.pickup && draft.dropoff && draft.price);

const buildCustomerName = (ctx: BotContext): string | undefined => {
  const first = ctx.session.user?.firstName?.trim();
  const last = ctx.session.user?.lastName?.trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || undefined;
};

const notifyOrderCreated = async (
  ctx: BotContext,
  order: OrderRecord,
  publishStatus: PublishOrderStatus,
): Promise<void> => {
  const lines = [
    `Заказ на доставку №${order.id} создан.`,
    `Стоимость по расчёту: ${formatPrice(order.price.amount, order.price.currency)}.`,
  ];

  if (publishStatus === 'missing_channel') {
    lines.push('⚠️ Канал курьеров не настроен. Мы свяжемся с вами вручную.');
  }

  const message = await ctx.reply(lines.join('\n'));
  ctx.session.ephemeralMessages.push(message.message_id);
};

const confirmOrder = async (ctx: BotContext, draft: ClientOrderDraftState): Promise<void> => {
  if (!ensureCompletion(draft)) {
    const warning = await ctx.reply('Не удалось подтвердить заказ: отсутствуют данные адресов.');
    ctx.session.ephemeralMessages.push(warning.message_id);
    resetDraft(draft);
    return;
  }

  if (draft.stage === 'creatingOrder') {
    await ctx.answerCbQuery('Заказ уже обрабатывается.');
    return;
  }

  draft.stage = 'creatingOrder';

  try {
    const order = await createOrder({
      kind: 'delivery',
      clientId: ctx.session.user?.id,
      clientPhone: ctx.session.phoneNumber,
      pickup: draft.pickup,
      dropoff: draft.dropoff,
      price: draft.price,
      metadata: {
        customerName: buildCustomerName(ctx),
        customerUsername: ctx.session.user?.username,
      },
    });

    const publishResult = await publishOrderToDriversChannel(ctx.telegram, order.id);
    await notifyOrderCreated(ctx, order, publishResult.status);
  } catch (error) {
    logger.error({ err: error }, 'Failed to create delivery order');
    const failure = await ctx.reply('Не удалось создать заказ. Попробуйте позже.');
    ctx.session.ephemeralMessages.push(failure.message_id);
  } finally {
    await removeConfirmationKeyboard(ctx, draft);
    resetDraft(draft);
  }
};

const processCancellationText = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  text: string,
): Promise<boolean> => {
  const normalized = text.trim().toLowerCase();
  if (normalized === '/cancel' || normalized === 'отмена' || normalized === 'cancel') {
    await cancelOrderDraft(ctx, draft);
    return true;
  }

  return false;
};

const handleIncomingText = async (ctx: BotContext, next: () => Promise<void>): Promise<void> => {
  if (!ensurePrivateChat(ctx)) {
    await next();
    return;
  }

  const message = ctx.message;
  if (!message || !('text' in message)) {
    await next();
    return;
  }

  const text = message.text.trim();
  if (text.startsWith('/')) {
    const draft = getDraft(ctx);
    const cancelled = await processCancellationText(ctx, draft, text);
    if (!cancelled) {
      await next();
    }
    return;
  }

  const draft = getDraft(ctx);
  switch (draft.stage) {
    case 'collectingPickup':
      if (await processCancellationText(ctx, draft, text)) {
        return;
      }
      await applyPickupAddress(ctx, draft, text);
      break;
    case 'collectingDropoff':
      if (await processCancellationText(ctx, draft, text)) {
        return;
      }
      await applyDropoffAddress(ctx, draft, text);
      break;
    case 'awaitingConfirmation': {
      if (await processCancellationText(ctx, draft, text)) {
        return;
      }
      const reminder = await ctx.reply(
        'Используйте кнопки ниже, чтобы подтвердить или отменить заказ.',
      );
      ctx.session.ephemeralMessages.push(reminder.message_id);
      break;
    }
    default:
      await next();
  }
};

const handleStart = async (ctx: BotContext): Promise<void> => {
  if (!ensurePrivateChat(ctx)) {
    await ctx.answerCbQuery('Оформление заказа доступно только в личном чате с ботом.');
    return;
  }

  await ctx.answerCbQuery();

  const draft = getDraft(ctx);
  resetDraft(draft);
  draft.stage = 'collectingPickup';
  resetDraft(ctx.session.client.taxi);

  await requestPickupAddress(ctx);
};

const handleConfirmationAction = async (ctx: BotContext): Promise<void> => {
  if (!ensurePrivateChat(ctx)) {
    await ctx.answerCbQuery('Подтвердите заказ в личном чате с ботом.');
    return;
  }

  await ctx.answerCbQuery();

  const draft = getDraft(ctx);
  await confirmOrder(ctx, draft);
};

const handleCancellationAction = async (ctx: BotContext): Promise<void> => {
  if (!ensurePrivateChat(ctx)) {
    await ctx.answerCbQuery('Отмените заказ в личном чате с ботом.');
    return;
  }

  await ctx.answerCbQuery('Оформление отменено.');

  const draft = getDraft(ctx);
  await cancelOrderDraft(ctx, draft);
};

export const registerDeliveryOrderFlow = (bot: Telegraf<BotContext>): void => {
  bot.action(START_DELIVERY_ORDER_ACTION, async (ctx) => {
    await handleStart(ctx);
  });

  bot.action(CONFIRM_DELIVERY_ORDER_ACTION, async (ctx) => {
    await handleConfirmationAction(ctx);
  });

  bot.action(CANCEL_DELIVERY_ORDER_ACTION, async (ctx) => {
    await handleCancellationAction(ctx);
  });

  bot.command('delivery', async (ctx) => {
    if (!ensurePrivateChat(ctx)) {
      return;
    }

    const draft = getDraft(ctx);
    resetDraft(draft);
    draft.stage = 'collectingPickup';
    resetDraft(ctx.session.client.taxi);

    await requestPickupAddress(ctx);
  });

  bot.on('text', async (ctx, next) => {
    await handleIncomingText(ctx, next);
  });
};
