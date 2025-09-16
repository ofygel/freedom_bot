import { Markup, Telegraf } from 'telegraf';
import type {
  Document,
  InlineKeyboardMarkup,
  Message,
  PhotoSize,
} from 'telegraf/typings/core/types/typegram';

import { logger } from '../../../config';
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

const KASPI_DETAILS = [
  'Получатель: Freedom Bot',
  'Kaspi Gold: 4400 4301 2345 6789',
  'Телефон: +7 (700) 000-00-00',
  'Комментарий: Подписка Freedom Bot',
];

const formatKaspiDetails = (): string[] => [
  'Оплатите через Kaspi по реквизитам:',
  ...KASPI_DETAILS,
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

const showSubscriptionStep = async (ctx: BotContext): Promise<void> => {
  const state = ensureExecutorState(ctx);
  const verification = state.verification[state.role];
  const copy = getExecutorRoleCopy(state.role);

  if (verification.status !== 'submitted') {
    const message = await ctx.reply(
      'Сначала завершите проверку документов, чтобы получить ссылку на канал.',
    );
    ctx.session.ephemeralMessages.push(message.message_id);
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
  state.subscription.status = 'awaitingReceipt';
  state.subscription.selectedPeriodId = period.id;
  state.subscription.pendingPaymentId = undefined;

  await ctx.answerCbQuery(`Период: ${period.label}`);

  const copy = getExecutorRoleCopy(state.role);
  const confirmation = await ctx.reply(buildPeriodConfirmationMessage(period, copy));
  ctx.session.ephemeralMessages.push(confirmation.message_id);

  await showExecutorMenu(ctx);
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
  const message = await ctx.reply(
    'Спасибо! Мы передали чек модераторам. Ожидайте решения, и мы пришлём ссылку после одобрения.',
  );
  ctx.session.ephemeralMessages.push(message.message_id);
};

const notifyReceiptFailed = async (ctx: BotContext): Promise<void> => {
  const message = await ctx.reply('Не удалось отправить чек на проверку. Попробуйте позже.');
  ctx.session.ephemeralMessages.push(message.message_id);
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
    const reminder = await ctx.reply('Выберите период подписки с помощью кнопок в меню.');
    ctx.session.ephemeralMessages.push(reminder.message_id);
    return;
  }

  const receipt = extractReceipt(message);
  if (!receipt) {
    const reminder = await ctx.reply('Отправьте, пожалуйста, фотографию или файл с чеком.');
    ctx.session.ephemeralMessages.push(reminder.message_id);
    return;
  }

  if (!ctx.from) {
    const reminder = await ctx.reply('Не удалось определить отправителя. Попробуйте ещё раз позже.');
    ctx.session.ephemeralMessages.push(reminder.message_id);
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
        telegramId: ctx.from.id,
        chatId: ctx.chat.id,
        username: ctx.from.username ?? undefined,
        firstName: ctx.from.first_name ?? undefined,
        lastName: ctx.from.last_name ?? undefined,
        phone: ctx.session.phoneNumber ?? undefined,
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
    await showExecutorMenu(ctx);
  } catch (error) {
    logger.error(
      { err: error, paymentId, telegramId: ctx.from.id },
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
    await showSubscriptionStep(ctx);
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
