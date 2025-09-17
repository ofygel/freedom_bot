import { Markup, Telegraf } from 'telegraf';
import type {
  Document,
  InlineKeyboardMarkup,
  Message,
  PhotoSize,
} from 'telegraf/typings/core/types/typegram';

import { config, logger } from '../../../config';
import type { BotContext } from '../../types';
import {
  EXECUTOR_MENU_ACTION,
  EXECUTOR_SUBSCRIPTION_ACTION,
  ensureExecutorState,
  showExecutorMenu,
} from './menu';
import { getExecutorRoleCopy } from './roleCopy';
import { ui } from '../../ui';
import {
  SUBSCRIPTION_PERIOD_OPTIONS,
  findSubscriptionPeriodOption,
  formatSubscriptionAmount,
  type SubscriptionPeriodOption,
} from './subscriptionPlans';
import { createShortId } from '../../../utils/ids';
import { submitSubscriptionPaymentReview } from '../../moderation/paymentQueue';

const SUBSCRIPTION_PERIOD_ACTION_PREFIX = 'executor:subscription:period';
const SUBSCRIPTION_VERIFICATION_REQUIRED_STEP_ID =
  'executor:subscription:verification-required';
const SUBSCRIPTION_CONFIRMATION_STEP_ID = 'executor:subscription:confirmation';
const SUBSCRIPTION_RECEIPT_ACCEPTED_STEP_ID = 'executor:subscription:receipt-accepted';
const SUBSCRIPTION_RECEIPT_FAILED_STEP_ID = 'executor:subscription:receipt-failed';
const SUBSCRIPTION_SELECT_PERIOD_REMINDER_STEP_ID = 'executor:subscription:select-period';
const SUBSCRIPTION_RECEIPT_REMINDER_STEP_ID = 'executor:subscription:receipt-reminder';

const formatKaspiDetails = (): string[] => [
  'Оплатите через Kaspi по реквизитам:',
  `Получатель: ${config.subscriptions.payment.kaspi.name}`,
  `Kaspi Gold: ${config.subscriptions.payment.kaspi.card}`,
  `Телефон: ${config.subscriptions.payment.kaspi.phone}`,
  'Комментарий: Подписка Freedom Bot',
];

const buildPeriodKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard(
    SUBSCRIPTION_PERIOD_OPTIONS.map((option) =>
      Markup.button.callback(
        `${option.label} — ${formatSubscriptionAmount(option.amount, option.currency)}`,
        `${SUBSCRIPTION_PERIOD_ACTION_PREFIX}:${option.id}`,
      ),
    ),
  ).reply_markup;

const buildSelectionText = (roleCopy: ReturnType<typeof getExecutorRoleCopy>): string => {
  const lines = [
    `${roleCopy.emoji} Подписка Freedom Bot для ${roleCopy.genitive}`,
    '',
    'Выберите период подписки и оплатите подходящий вариант.',
    ...SUBSCRIPTION_PERIOD_OPTIONS.map(
      (option) => `• ${option.label} — ${formatSubscriptionAmount(option.amount, option.currency)}`,
    ),
    '',
    ...formatKaspiDetails(),
    '',
    'После оплаты отправьте чек в этот чат, мы проверим его и пришлём ссылку на канал.',
  ];

  return lines.join('\n');
};

export interface StartExecutorSubscriptionOptions {
  skipVerificationCheck?: boolean;
}

export const startExecutorSubscription = async (
  ctx: BotContext,
  options: StartExecutorSubscriptionOptions = {},
): Promise<void> => {
  const state = ensureExecutorState(ctx);
  const copy = getExecutorRoleCopy(state.role);

  const isVerified = Boolean(ctx.auth.executor.verifiedRoles[state.role]) || ctx.auth.executor.isVerified;

  if (!options.skipVerificationCheck && !isVerified) {
    state.subscription.status = 'idle';
    state.subscription.selectedPeriodId = undefined;
    state.subscription.pendingPaymentId = undefined;
    await ui.step(ctx, {
      id: SUBSCRIPTION_VERIFICATION_REQUIRED_STEP_ID,
      text: 'Сначала завершите проверку документов, чтобы получить ссылку на канал.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  state.subscription.status = 'selectingPeriod';
  state.subscription.selectedPeriodId = undefined;
  state.subscription.pendingPaymentId = undefined;

  const keyboard = buildPeriodKeyboard();
  const text = buildSelectionText(copy);

  await ui.step(ctx, {
    id: 'executor:subscription:step',
    text,
    keyboard,
    homeAction: EXECUTOR_MENU_ACTION,
  });
};

const buildPeriodConfirmationMessage = (
  period: SubscriptionPeriodOption,
  roleCopy: ReturnType<typeof getExecutorRoleCopy>,
): string => {
  const lines = [
    `Вы выбрали подписку на ${period.label} для ${roleCopy.genitive}.`,
    `Сумма к оплате: ${formatSubscriptionAmount(period.amount, period.currency)}.`,
    '',
    ...formatKaspiDetails(),
    '',
    'Отправьте чек об оплате в этот чат. После подтверждения модераторами мы пришлём ссылку на канал.',
  ];

  return lines.join('\n');
};

const handlePeriodSelection = async (
  ctx: BotContext,
  periodId: string,
): Promise<void> => {
  const period = findSubscriptionPeriodOption(periodId);
  if (!period) {
    await ctx.answerCbQuery('Неизвестный период подписки.');
    return;
  }

  const state = ensureExecutorState(ctx);
  const isVerified = Boolean(ctx.auth.executor.verifiedRoles[state.role]) || ctx.auth.executor.isVerified;

  if (!isVerified) {
    state.subscription.status = 'idle';
    state.subscription.selectedPeriodId = undefined;
    state.subscription.pendingPaymentId = undefined;
    await ctx.answerCbQuery('Сначала завершите проверку документов.');
    await ui.step(ctx, {
      id: SUBSCRIPTION_VERIFICATION_REQUIRED_STEP_ID,
      text: 'Сначала завершите проверку документов, чтобы получить ссылку на канал.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  state.subscription.status = 'awaitingReceipt';
  state.subscription.selectedPeriodId = period.id;
  state.subscription.pendingPaymentId = undefined;

  await ctx.answerCbQuery(`Период: ${period.label}`);

  const copy = getExecutorRoleCopy(state.role);
  await ui.step(ctx, {
    id: SUBSCRIPTION_CONFIRMATION_STEP_ID,
    text: buildPeriodConfirmationMessage(period, copy),
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });

  await showExecutorMenu(ctx, { skipAccessCheck: true });
};

interface ReceiptPayload {
  type: 'photo' | 'document';
  fileId: string;
}

const extractReceipt = (message: Message): ReceiptPayload | null => {
  if ('photo' in message && Array.isArray(message.photo) && message.photo.length > 0) {
    const photoSizes = message.photo as PhotoSize[];
    const bestPhoto = photoSizes[photoSizes.length - 1];
    return { type: 'photo', fileId: bestPhoto.file_id } satisfies ReceiptPayload;
  }

  if ('document' in message && message.document) {
    const document = message.document as Document;
    return { type: 'document', fileId: document.file_id } satisfies ReceiptPayload;
  }

  return null;
};

const notifyReceiptAccepted = async (ctx: BotContext): Promise<void> => {
  await ui.step(ctx, {
    id: SUBSCRIPTION_RECEIPT_ACCEPTED_STEP_ID,
    text: 'Спасибо! Мы передали чек модераторам. Ожидайте решения, и мы пришлём ссылку после одобрения.',
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });
};

const notifyReceiptFailed = async (ctx: BotContext): Promise<void> => {
  await ui.step(ctx, {
    id: SUBSCRIPTION_RECEIPT_FAILED_STEP_ID,
    text: 'Не удалось отправить чек на проверку. Попробуйте позже.',
    cleanup: true,
    homeAction: EXECUTOR_MENU_ACTION,
  });
};

const buildPaymentId = (): string => `manual-${Date.now()}-${createShortId({ length: 6 })}`;

const handleReceiptUpload = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const message = ctx.message;
  if (!message) {
    return;
  }

  const state = ensureExecutorState(ctx);
  const subscription = state.subscription;

  if (subscription.status !== 'awaitingReceipt') {
    return;
  }

  const period = findSubscriptionPeriodOption(subscription.selectedPeriodId);
  if (!period) {
    await ui.step(ctx, {
      id: SUBSCRIPTION_SELECT_PERIOD_REMINDER_STEP_ID,
      text: 'Выберите период подписки с помощью кнопок в меню.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  const receipt = extractReceipt(message);
  if (!receipt) {
    await ui.step(ctx, {
      id: SUBSCRIPTION_RECEIPT_REMINDER_STEP_ID,
      text: 'Отправьте, пожалуйста, фотографию или файл с чеком.',
      cleanup: true,
      homeAction: EXECUTOR_MENU_ACTION,
    });
    return;
  }

  const paymentId = buildPaymentId();
  subscription.pendingPaymentId = paymentId;

  try {
    const result = await submitSubscriptionPaymentReview(ctx.telegram, {
      paymentId,
      period,
      submittedAt: new Date(),
      executor: {
        role: state.role,
        telegramId: ctx.auth.user.telegramId,
        chatId: ctx.chat.id,
        username: ctx.auth.user.username ?? undefined,
        firstName: ctx.auth.user.firstName ?? undefined,
        lastName: ctx.auth.user.lastName ?? undefined,
        phone: ctx.auth.user.phone ?? ctx.session.phoneNumber ?? undefined,
      },
      receipt: {
        chatId: ctx.chat.id,
        messageId: message.message_id,
        fileId: receipt.fileId,
        type: receipt.type,
      },
    });

    if (result.status === 'missing_channel') {
      subscription.status = 'awaitingReceipt';
      subscription.pendingPaymentId = undefined;
      await notifyReceiptFailed(ctx);
      return;
    }

    subscription.status = 'pendingModeration';
    subscription.moderationChatId = result.chatId;
    subscription.moderationMessageId = result.messageId;

    await notifyReceiptAccepted(ctx);
    await showExecutorMenu(ctx, { skipAccessCheck: true });
  } catch (error) {
    logger.error(
      { err: error, paymentId, telegramId: ctx.auth.user.telegramId },
      'Failed to submit subscription payment for moderation',
    );
    subscription.status = 'awaitingReceipt';
    subscription.pendingPaymentId = undefined;
    await notifyReceiptFailed(ctx);
  }
};

export const registerExecutorSubscription = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_SUBSCRIPTION_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    await ctx.answerCbQuery();
    await startExecutorSubscription(ctx);
  });

  const periodPattern = new RegExp(`^${SUBSCRIPTION_PERIOD_ACTION_PREFIX}:(\\d+)$`);
  bot.action(periodPattern, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    const match = ctx.match as RegExpMatchArray | undefined;
    const periodId = match?.[1];
    if (!periodId) {
      await ctx.answerCbQuery('Некорректный выбор.');
      return;
    }

    await handlePeriodSelection(ctx, periodId);
  });

  bot.on('photo', async (ctx) => {
    await handleReceiptUpload(ctx);
  });

  bot.on('document', async (ctx) => {
    await handleReceiptUpload(ctx);
  });
};
