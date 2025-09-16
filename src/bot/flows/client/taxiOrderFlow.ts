import { Telegraf } from 'telegraf';

import { publishOrderToDriversChannel, type PublishOrderStatus } from '../../../channels/ordersChannel';
import { logger } from '../../../config';
import { createOrder } from '../../../db/orders';
import type { OrderRecord } from '../../../types';
import {
  buildCustomerName,
  buildOrderSummary,
  isOrderDraftComplete,
  resetClientOrderDraft,
  type CompletedOrderDraft,
} from '../../services/orders';
import { geocodeOrderLocation } from '../../services/geocode';
import { estimateTaxiPrice, formatPriceAmount } from '../../services/pricing';
import { rememberEphemeralMessage, clearInlineKeyboard } from '../../services/cleanup';
import { ensurePrivateCallback, isPrivateChat } from '../../services/access';
import { buildConfirmCancelKeyboard } from '../../keyboards/common';
import type { BotContext, ClientOrderDraftState } from '../../types';

export const START_TAXI_ORDER_ACTION = 'client:order:taxi:start';
const CONFIRM_TAXI_ORDER_ACTION = 'client:order:taxi:confirm';
const CANCEL_TAXI_ORDER_ACTION = 'client:order:taxi:cancel';

const getDraft = (ctx: BotContext): ClientOrderDraftState => ctx.session.client.taxi;

const requestPickupAddress = async (ctx: BotContext): Promise<void> => {
  const prompt = await ctx.reply(
    ['Введите адрес подачи такси.', 'Например: «Достык 1, подъезд 3».'].join('\n'),
  );
  rememberEphemeralMessage(ctx, prompt.message_id);
};

const requestDropoffAddress = async (ctx: BotContext, pickup: CompletedOrderDraft['pickup']): Promise<void> => {
  const prompt = await ctx.reply(
    [`Адрес подачи: ${pickup.address}.`, 'Теперь укажите пункт назначения.'].join('\n'),
  );
  rememberEphemeralMessage(ctx, prompt.message_id);
};

const handleGeocodingFailure = async (ctx: BotContext): Promise<void> => {
  const message = await ctx.reply(
    'Не удалось распознать адрес. Пожалуйста, уточните формулировку и попробуйте снова.',
  );
  rememberEphemeralMessage(ctx, message.message_id);
};

const applyPickupAddress = async (ctx: BotContext, draft: ClientOrderDraftState, text: string) => {
  const pickup = await geocodeOrderLocation(text);
  if (!pickup) {
    await handleGeocodingFailure(ctx);
    return;
  }

  draft.pickup = pickup;
  draft.stage = 'collectingDropoff';

  await requestDropoffAddress(ctx, pickup);
};

const buildConfirmationKeyboard = () =>
  buildConfirmCancelKeyboard(CONFIRM_TAXI_ORDER_ACTION, CANCEL_TAXI_ORDER_ACTION);

const showConfirmation = async (ctx: BotContext, draft: CompletedOrderDraft): Promise<void> => {
  const summary = buildOrderSummary(draft, {
    title: '🚕 Предварительный заказ такси',
    pickupLabel: '📍 Подача',
    dropoffLabel: '🎯 Назначение',
    distanceLabel: '📏 Расстояние',
    priceLabel: '💰 Оценка стоимости',
  });

  const keyboard = buildConfirmationKeyboard();
  const message = await ctx.reply(summary, { reply_markup: keyboard });
  draft.confirmationMessageId = message.message_id;
};

const applyDropoffAddress = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  text: string,
): Promise<void> => {
  const dropoff = await geocodeOrderLocation(text);
  if (!dropoff) {
    await handleGeocodingFailure(ctx);
    return;
  }

  draft.dropoff = dropoff;

  if (!draft.pickup) {
    logger.warn('Taxi order draft is missing pickup after dropoff geocode');
    draft.stage = 'idle';
    return;
  }

  draft.price = estimateTaxiPrice(draft.pickup, dropoff);
  draft.stage = 'awaitingConfirmation';

  if (isOrderDraftComplete(draft)) {
    await showConfirmation(ctx, draft);
  }
};

const cancelOrderDraft = async (ctx: BotContext, draft: ClientOrderDraftState): Promise<void> => {
  await clearInlineKeyboard(ctx, draft.confirmationMessageId);
  resetClientOrderDraft(draft);

  const message = await ctx.reply('Оформление заказа отменено.');
  rememberEphemeralMessage(ctx, message.message_id);
};

const notifyOrderCreated = async (
  ctx: BotContext,
  order: OrderRecord,
  publishStatus: PublishOrderStatus,
): Promise<void> => {
  const lines = [
    `Заказ №${order.id} успешно создан.`,
    `Стоимость по расчёту: ${formatPriceAmount(order.price.amount, order.price.currency)}.`,
  ];

  if (publishStatus === 'missing_channel') {
    lines.push('⚠️ Канал курьеров не настроен. Мы свяжемся с вами вручную.');
  }

  const message = await ctx.reply(lines.join('\n'));
  rememberEphemeralMessage(ctx, message.message_id);
};

const confirmOrder = async (ctx: BotContext, draft: ClientOrderDraftState): Promise<void> => {
  if (!isOrderDraftComplete(draft)) {
    const warning = await ctx.reply('Не удалось подтвердить заказ: отсутствуют данные адресов.');
    rememberEphemeralMessage(ctx, warning.message_id);
    resetClientOrderDraft(draft);
    return;
  }

  if (draft.stage === 'creatingOrder') {
    await ctx.answerCbQuery('Заказ уже обрабатывается.');
    return;
  }

  draft.stage = 'creatingOrder';

  try {
    const order = await createOrder({
      kind: 'taxi',
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
    logger.error({ err: error }, 'Failed to create taxi order');
    const failure = await ctx.reply('Не удалось создать заказ. Попробуйте позже.');
    rememberEphemeralMessage(ctx, failure.message_id);
  } finally {
    await clearInlineKeyboard(ctx, draft.confirmationMessageId);
    resetClientOrderDraft(draft);
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
  if (!isPrivateChat(ctx)) {
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
      rememberEphemeralMessage(ctx, reminder.message_id);
      break;
    }
    default:
      await next();
  }
};

const handleStart = async (ctx: BotContext): Promise<void> => {
  if (!(await ensurePrivateCallback(ctx, undefined, 'Оформление заказа доступно только в личном чате с ботом.'))) {
    return;
  }

  const draft = getDraft(ctx);
  resetClientOrderDraft(draft);
  draft.stage = 'collectingPickup';
  resetClientOrderDraft(ctx.session.client.delivery);

  await requestPickupAddress(ctx);
};

const handleConfirmationAction = async (ctx: BotContext): Promise<void> => {
  if (!(await ensurePrivateCallback(ctx, undefined, 'Подтвердите заказ в личном чате с ботом.'))) {
    return;
  }

  const draft = getDraft(ctx);
  await confirmOrder(ctx, draft);
};

const handleCancellationAction = async (ctx: BotContext): Promise<void> => {
  if (!(await ensurePrivateCallback(ctx, 'Оформление отменено.', 'Отмените заказ в личном чате с ботом.'))) {
    return;
  }

  const draft = getDraft(ctx);
  await cancelOrderDraft(ctx, draft);
};

export const registerTaxiOrderFlow = (bot: Telegraf<BotContext>): void => {
  bot.action(START_TAXI_ORDER_ACTION, async (ctx) => {
    await handleStart(ctx);
  });

  bot.action(CONFIRM_TAXI_ORDER_ACTION, async (ctx) => {
    await handleConfirmationAction(ctx);
  });

  bot.action(CANCEL_TAXI_ORDER_ACTION, async (ctx) => {
    await handleCancellationAction(ctx);
  });

  bot.command('taxi', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      return;
    }

    const draft = getDraft(ctx);
    resetClientOrderDraft(draft);
    draft.stage = 'collectingPickup';
    resetClientOrderDraft(ctx.session.client.delivery);

    await requestPickupAddress(ctx);
  });

  bot.on('text', async (ctx, next) => {
    await handleIncomingText(ctx, next);
  });
};
