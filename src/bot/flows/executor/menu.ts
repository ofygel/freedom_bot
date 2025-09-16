import { Markup, Telegraf } from 'telegraf';

import { logger } from '../../../config';
import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ExecutorFlowState,
} from '../../types';
import { getExecutorRoleCopy } from './roleCopy';

export const EXECUTOR_VERIFICATION_ACTION = 'executor:verification:start';
export const EXECUTOR_SUBSCRIPTION_ACTION = 'executor:subscription:link';
export const EXECUTOR_MENU_ACTION = 'executor:menu:refresh';

const ensurePositiveRequirement = (value?: number): number => {
  if (!value || value <= 0) {
    return EXECUTOR_VERIFICATION_PHOTO_COUNT;
  }

  return value;
};

const createDefaultVerificationState = () => ({
  status: 'idle' as const,
  requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
  uploadedPhotos: [],
  submittedAt: undefined as number | undefined,
  moderationThreadMessageId: undefined as number | undefined,
});

export const ensureExecutorState = (ctx: BotContext): ExecutorFlowState => {
  if (!ctx.session.executor) {
    ctx.session.executor = {
      role: 'courier',
      verification: createDefaultVerificationState(),
      subscription: {},
    } satisfies ExecutorFlowState;
  } else {
    if (!ctx.session.executor.role) {
      ctx.session.executor.role = 'courier';
    }
    ctx.session.executor.verification.requiredPhotos = ensurePositiveRequirement(
      ctx.session.executor.verification.requiredPhotos,
    );
  }

  return ctx.session.executor;
};

export const resetVerificationState = (state: ExecutorFlowState): void => {
  state.verification = {
    ...createDefaultVerificationState(),
    requiredPhotos: ensurePositiveRequirement(state.verification.requiredPhotos),
  };
};

const buildMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📸 Отправить документы', EXECUTOR_VERIFICATION_ACTION)],
    [Markup.button.callback('📨 Получить ссылку на канал', EXECUTOR_SUBSCRIPTION_ACTION)],
    [Markup.button.callback('🔄 Обновить меню', EXECUTOR_MENU_ACTION)],
  ]);

const formatTimestamp = (timestamp: number): string => {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

const buildVerificationSection = (state: ExecutorFlowState): string[] => {
  const { verification } = state;
  const uploaded = verification.uploadedPhotos.length;
  const required = ensurePositiveRequirement(verification.requiredPhotos);

  const statusLabel = {
    idle: 'не начата',
    collecting: 'ожидаем фотографии',
    submitted: 'на проверке',
  }[verification.status];

  const instructions = (() => {
    switch (verification.status) {
      case 'idle':
        return 'Нажмите «📸 Отправить документы», чтобы начать проверку.';
      case 'collecting':
        return 'Пришлите фотографии документов в этот чат.';
      case 'submitted':
        return 'Мы передали документы модераторам. Ожидайте обратной связи.';
      default:
        return undefined;
    }
  })();

  const lines = [
    `Статус проверки: ${statusLabel}.`,
    `Фотографии: ${uploaded}/${required}.`,
  ];

  if (instructions) {
    lines.push(instructions);
  }

  return lines;
};

const buildSubscriptionSection = (state: ExecutorFlowState): string[] => {
  const { verification, subscription } = state;
  const copy = getExecutorRoleCopy(state.role);
  const channelLabel = `канал ${copy.pluralGenitive}`;

  if (verification.status !== 'submitted') {
    return [`Ссылка на ${channelLabel} станет доступна после отправки документов.`];
  }

  if (subscription.lastInviteLink) {
    const issued = subscription.lastIssuedAt
      ? ` (выдана ${formatTimestamp(subscription.lastIssuedAt)})`
      : '';
    return [
      `Ссылка на канал уже выдана${issued}. При необходимости запросите новую с помощью кнопки ниже.`,
    ];
  }

  return [
    `Получите ссылку на ${channelLabel} после проверки — используйте кнопку ниже.`,
  ];
};

const buildMenuText = (state: ExecutorFlowState): string => {
  const copy = getExecutorRoleCopy(state.role);
  const parts = [
    `${copy.emoji} Меню ${copy.genitive} Freedom Bot`,
    '',
    ...buildVerificationSection(state),
    '',
    ...buildSubscriptionSection(state),
  ];

  return parts.join('\n');
};

export const showExecutorMenu = async (ctx: BotContext): Promise<void> => {
  if (!ctx.chat) {
    return;
  }

  const state = ensureExecutorState(ctx);
  const text = buildMenuText(state);
  const keyboard = buildMenuKeyboard();
  const chatId = ctx.chat.id;

  if (state.menuMessageId) {
    try {
      await ctx.telegram.editMessageText(chatId, state.menuMessageId, undefined, text, {
        reply_markup: keyboard.reply_markup,
      });
      return;
    } catch (error) {
      logger.debug(
        { err: error, chatId, messageId: state.menuMessageId },
        'Failed to update executor menu message, sending a new one',
      );
      state.menuMessageId = undefined;
    }
  }

  const message = await ctx.reply(text, keyboard);
  state.menuMessageId = message.message_id;
};

export const registerExecutorMenu = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_MENU_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    await ctx.answerCbQuery();
    ensureExecutorState(ctx);
    await showExecutorMenu(ctx);
  });
};
