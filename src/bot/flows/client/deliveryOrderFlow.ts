import { Telegraf } from 'telegraf';
import type {
  InlineKeyboardMarkup,
  Location as TelegramLocation,
} from 'telegraf/typings/core/types/typegram';

import { publishOrderToDriversChannel, type PublishOrderStatus } from '../../channels/ordersChannel';
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
import {
  geocodeOrderLocation,
  geocodeTelegramLocation,
  isTwoGisLink,
} from '../../services/geocode';
import {
  estimateDeliveryPrice,
  formatPriceAmount,
} from '../../services/pricing';
import { rememberEphemeralMessage, clearInlineKeyboard } from '../../services/cleanup';
import { ensurePrivateCallback, isPrivateChat } from '../../services/access';
import { buildConfirmCancelKeyboard } from '../../keyboards/common';
import type { BotContext, ClientOrderDraftState } from '../../types';
import { ui } from '../../ui';
import { CLIENT_MENU_ACTION } from './menu';

export const START_DELIVERY_ORDER_ACTION = 'client:order:delivery:start';
const CONFIRM_DELIVERY_ORDER_ACTION = 'client:order:delivery:confirm';
const CANCEL_DELIVERY_ORDER_ACTION = 'client:order:delivery:cancel';

const getDraft = (ctx: BotContext): ClientOrderDraftState => ctx.session.client.delivery;

const DELIVERY_STEP_ID = 'client:delivery:step';

const updateDeliveryStep = (
  ctx: BotContext,
  text: string,
  keyboard?: InlineKeyboardMarkup,
) =>
  ui.step(ctx, {
    id: DELIVERY_STEP_ID,
    text,
    keyboard,
    homeAction: CLIENT_MENU_ACTION,
  });

const ADDRESS_INPUT_HINTS = [
  '• Отправьте ссылку 2ГИС на точку.',
  '• Поделитесь геопозицией через Telegram (скрепка → «Геопозиция»).',
  '• Введите адрес вручную — внимательно проверьте город, улицу и дом.',
] as const;

const buildAddressPrompt = (lines: string[]): string =>
  [...lines, ...ADDRESS_INPUT_HINTS].join('\n');

const remindManualAddressAccuracy = async (ctx: BotContext): Promise<void> => {
  const warning = await ctx.reply(
    '⚠️ При ручном вводе адреса укажите город, улицу, дом и ориентиры. Если есть ссылка 2ГИС или геопозиция, отправьте её.',
  );
  rememberEphemeralMessage(ctx, warning.message_id);
};

const remindConfirmationActions = async (ctx: BotContext): Promise<void> => {
  const reminder = await ctx.reply(
    'Используйте кнопки ниже, чтобы подтвердить или отменить заказ.',
  );
  rememberEphemeralMessage(ctx, reminder.message_id);
};

const remindDeliveryCommentRequirement = async (ctx: BotContext): Promise<void> => {
  const warning = await ctx.reply(
    'Комментарий обязателен. Опишите, что передать курьеру и кому, укажите подъезд, код домофона и контакты.',
  );
  rememberEphemeralMessage(ctx, warning.message_id);
};

const requestPickupAddress = async (ctx: BotContext): Promise<void> => {
  await updateDeliveryStep(
    ctx,
    buildAddressPrompt(['Укажите точку забора посылки одним из способов:']),
  );
};

const requestDropoffAddress = async (ctx: BotContext, pickup: CompletedOrderDraft['pickup']): Promise<void> => {
  await updateDeliveryStep(
    ctx,
    buildAddressPrompt([
      `Адрес забора: ${pickup.address}.`,
      '',
      'Теперь отправьте адрес доставки одним из способов:',
    ]),
  );
};

const requestDeliveryComment = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
): Promise<void> => {
  if (!draft.pickup || !draft.dropoff) {
    return;
  }

  await updateDeliveryStep(
    ctx,
    [
      `Адрес забора: ${draft.pickup.address}.`,
      `Адрес доставки: ${draft.dropoff.address}.`,
      '',
      'Добавьте обязательный комментарий для курьера:',
      '• Что нужно забрать или доставить.',
      '• Кому передать и как с ним связаться.',
      '• Подъезд, код домофона и другие ориентиры.',
    ].join('\n'),
  );
};

const handleGeocodingFailure = async (ctx: BotContext): Promise<void> => {
  const message = await ctx.reply(
    'Не удалось распознать адрес. Пожалуйста, уточните формулировку и попробуйте снова.',
  );
  rememberEphemeralMessage(ctx, message.message_id);
};

const applyPickupDetails = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  pickup: CompletedOrderDraft['pickup'],
): Promise<void> => {
  draft.pickup = pickup;
  draft.stage = 'collectingDropoff';

  await requestDropoffAddress(ctx, pickup);
};

const applyDropoffDetails = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  dropoff: CompletedOrderDraft['dropoff'],
): Promise<void> => {
  draft.dropoff = dropoff;

  if (!draft.pickup) {
    logger.warn('Delivery order draft is missing pickup after dropoff geocode');
    draft.stage = 'idle';
    return;
  }

  draft.price = estimateDeliveryPrice(draft.pickup, dropoff);
  draft.stage = 'collectingComment';

  await requestDeliveryComment(ctx, draft);
};

const applyPickupAddress = async (ctx: BotContext, draft: ClientOrderDraftState, text: string) => {
  const pickup = await geocodeOrderLocation(text);
  if (!pickup) {
    await handleGeocodingFailure(ctx);
    return;
  }
  await applyPickupDetails(ctx, draft, pickup);

  if (!isTwoGisLink(text)) {
    await remindManualAddressAccuracy(ctx);
  }
};

const buildConfirmationKeyboard = () =>
  buildConfirmCancelKeyboard(CONFIRM_DELIVERY_ORDER_ACTION, CANCEL_DELIVERY_ORDER_ACTION);

const showConfirmation = async (ctx: BotContext, draft: CompletedOrderDraft): Promise<void> => {
  const comment = draft.notes?.trim();
  const summary = buildOrderSummary(draft, {
    title: '🚚 Доставка курьером',
    pickupLabel: '📦 Забор',
    dropoffLabel: '📮 Доставка',
    distanceLabel: '📏 Расстояние',
    priceLabel: '💰 Оценка стоимости',
    instructions: comment
      ? ['📝 Комментарий: ' + comment, 'Подтвердите заказ или отмените оформление.']
      : undefined,
  });

  const keyboard = buildConfirmationKeyboard();
  const result = await updateDeliveryStep(ctx, summary, keyboard);
  draft.confirmationMessageId = result?.messageId;
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
  await applyDropoffDetails(ctx, draft, dropoff);

  if (!isTwoGisLink(text)) {
    await remindManualAddressAccuracy(ctx);
  }
};

const applyPickupLocation = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  location: TelegramLocation,
): Promise<void> => {
  const pickup = await geocodeTelegramLocation(location, { label: 'Геопозиция забора' });
  if (!pickup) {
    await handleGeocodingFailure(ctx);
    return;
  }

  await applyPickupDetails(ctx, draft, pickup);
};

const applyDropoffLocation = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  location: TelegramLocation,
): Promise<void> => {
  const dropoff = await geocodeTelegramLocation(location, { label: 'Геопозиция доставки' });
  if (!dropoff) {
    await handleGeocodingFailure(ctx);
    return;
  }

  await applyDropoffDetails(ctx, draft, dropoff);
};

const applyDeliveryComment = async (
  ctx: BotContext,
  draft: ClientOrderDraftState,
  text: string,
): Promise<void> => {
  const trimmed = text.trim();
  if (!trimmed) {
    await remindDeliveryCommentRequirement(ctx);
    return;
  }

  draft.notes = trimmed;
  draft.stage = 'awaitingConfirmation';

  if (isOrderDraftComplete(draft)) {
    await showConfirmation(ctx, draft);
    return;
  }

  logger.warn('Delivery order draft is incomplete after collecting comment');
  draft.stage = 'idle';
  const failure = await ctx.reply('Не удалось сохранить заказ. Попробуйте начать заново.');
  rememberEphemeralMessage(ctx, failure.message_id);
};

const cancelOrderDraft = async (ctx: BotContext, draft: ClientOrderDraftState): Promise<void> => {
  await clearInlineKeyboard(ctx, draft.confirmationMessageId);
  resetClientOrderDraft(draft);

  const message = await ctx.reply('Оформление доставки отменено.');
  rememberEphemeralMessage(ctx, message.message_id);
};

const notifyOrderCreated = async (
  ctx: BotContext,
  order: OrderRecord,
  publishStatus: PublishOrderStatus,
): Promise<void> => {
  const lines = [
    `Заказ на доставку №${order.id} создан.`,
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

  const comment = draft.notes?.trim();
  if (!comment) {
    draft.stage = 'collectingComment';
    await remindDeliveryCommentRequirement(ctx);
    await requestDeliveryComment(ctx, draft);
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
        notes: comment,
      },
    });

    const publishResult = await publishOrderToDriversChannel(ctx.telegram, order.id);
    await notifyOrderCreated(ctx, order, publishResult.status);
  } catch (error) {
    logger.error({ err: error }, 'Failed to create delivery order');
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
    case 'collectingComment':
      if (await processCancellationText(ctx, draft, text)) {
        return;
      }
      await applyDeliveryComment(ctx, draft, text);
      break;
    case 'awaitingConfirmation': {
      if (await processCancellationText(ctx, draft, text)) {
        return;
      }
      await remindConfirmationActions(ctx);
      break;
    }
    default:
      await next();
  }
};

const handleIncomingLocation = async (
  ctx: BotContext,
  next: () => Promise<void>,
): Promise<void> => {
  if (!isPrivateChat(ctx)) {
    await next();
    return;
  }

  const message = ctx.message;
  if (!message || !('location' in message) || !message.location) {
    await next();
    return;
  }

  const draft = getDraft(ctx);

  switch (draft.stage) {
    case 'collectingPickup':
      await applyPickupLocation(ctx, draft, message.location);
      return;
    case 'collectingDropoff':
      await applyDropoffLocation(ctx, draft, message.location);
      return;
    case 'collectingComment':
      await remindDeliveryCommentRequirement(ctx);
      return;
    case 'awaitingConfirmation':
      await remindConfirmationActions(ctx);
      return;
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
  resetClientOrderDraft(ctx.session.client.taxi);

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
    if (!isPrivateChat(ctx)) {
      return;
    }

    const draft = getDraft(ctx);
    resetClientOrderDraft(draft);
    draft.stage = 'collectingPickup';
    resetClientOrderDraft(ctx.session.client.taxi);

    await requestPickupAddress(ctx);
  });

  bot.on('location', async (ctx, next) => {
    await handleIncomingLocation(ctx, next);
  });

  bot.on('text', async (ctx, next) => {
    await handleIncomingText(ctx, next);
  });
};
