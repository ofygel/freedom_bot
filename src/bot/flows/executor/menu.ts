import { Markup, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import {
  EXECUTOR_ROLES,
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ExecutorFlowState,
  type ExecutorSubscriptionState,
  type ExecutorVerificationRoleState,
} from '../../types';
import { ui } from '../../ui';
import { startExecutorSubscription } from './subscription';
import { getExecutorRoleCopy } from './roleCopy';
import { findSubscriptionPeriodOption } from './subscriptionPlans';
import { startExecutorVerification } from './verification';

export const EXECUTOR_VERIFICATION_ACTION = 'executor:verification:start';
export const EXECUTOR_SUBSCRIPTION_ACTION = 'executor:subscription:link';
export const EXECUTOR_MENU_ACTION = 'executor:menu:refresh';
const EXECUTOR_MENU_STEP_ID = 'executor:menu:main';

const ensurePositiveRequirement = (_value?: number): number => EXECUTOR_VERIFICATION_PHOTO_COUNT;

const cloneUploadedPhotos = (
  photos?: ExecutorVerificationRoleState['uploadedPhotos'],
): ExecutorVerificationRoleState['uploadedPhotos'] => {
  if (!Array.isArray(photos) || photos.length === 0) {
    return [];
  }

  return photos.map((photo) => ({ ...photo }));
};

const cloneModerationState = (
  moderation?: ExecutorVerificationRoleState['moderation'],
): ExecutorVerificationRoleState['moderation'] => {
  if (!moderation) {
    return undefined;
  }

  return { ...moderation };
};

const createRoleVerificationState = (): ExecutorVerificationRoleState => ({
  status: 'idle',
  requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
  uploadedPhotos: [],
  submittedAt: undefined,
  moderation: undefined,
});

const createSubscriptionState = (): ExecutorSubscriptionState => ({
  status: 'idle',
  selectedPeriodId: undefined,
  pendingPaymentId: undefined,
  moderationChatId: undefined,
  moderationMessageId: undefined,
  lastInviteLink: undefined,
  lastIssuedAt: undefined,
});

const normaliseRoleVerificationState = (
  value?: Partial<ExecutorVerificationRoleState>,
): ExecutorVerificationRoleState => ({
  status: value?.status ?? 'idle',
  requiredPhotos: ensurePositiveRequirement(value?.requiredPhotos),
  uploadedPhotos: cloneUploadedPhotos(value?.uploadedPhotos),
  submittedAt: value?.submittedAt,
  moderation: cloneModerationState(value?.moderation),
});

const createDefaultVerificationState = () => {
  const verification = {} as ExecutorFlowState['verification'];
  for (const role of EXECUTOR_ROLES) {
    verification[role] = createRoleVerificationState();
  }
  return verification;
};

const hasRoleEntries = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return EXECUTOR_ROLES.some((role) => role in candidate);
};

const normaliseVerificationState = (
  value: ExecutorFlowState['verification'] | ExecutorVerificationRoleState | undefined,
): ExecutorFlowState['verification'] => {
  const verification = createDefaultVerificationState();

  if (!value) {
    return verification;
  }

  if (hasRoleEntries(value)) {
    const map = value as Partial<Record<string, Partial<ExecutorVerificationRoleState>>>;
    for (const role of EXECUTOR_ROLES) {
      const roleState = map[role] ?? verification[role];
      verification[role] = normaliseRoleVerificationState(roleState);
    }
    return verification;
  }

  const fallback = normaliseRoleVerificationState(value as Partial<ExecutorVerificationRoleState>);
  for (const role of EXECUTOR_ROLES) {
    verification[role] = {
      ...fallback,
      uploadedPhotos: cloneUploadedPhotos(fallback.uploadedPhotos),
    };
  }

  return verification;
};

const normaliseSubscriptionState = (
  value: Partial<ExecutorSubscriptionState> | undefined,
): ExecutorSubscriptionState => ({
  status: value?.status ?? 'idle',
  selectedPeriodId: value?.selectedPeriodId,
  pendingPaymentId: value?.pendingPaymentId,
  moderationChatId: value?.moderationChatId,
  moderationMessageId: value?.moderationMessageId,
  lastInviteLink: value?.lastInviteLink,
  lastIssuedAt: value?.lastIssuedAt,
});

export const ensureExecutorState = (ctx: BotContext): ExecutorFlowState => {
  if (!ctx.session.executor) {
    ctx.session.executor = {
      role: 'courier',
      verification: createDefaultVerificationState(),
      subscription: createSubscriptionState(),
    } satisfies ExecutorFlowState;
  } else {
    if (!ctx.session.executor.role || !EXECUTOR_ROLES.includes(ctx.session.executor.role)) {
      ctx.session.executor.role = 'courier';
    }
    ctx.session.executor.verification = normaliseVerificationState(
      ctx.session.executor.verification,
    );
    ctx.session.executor.subscription = normaliseSubscriptionState(
      ctx.session.executor.subscription,
    );
  }

  return ctx.session.executor;
};

export const resetVerificationState = (state: ExecutorFlowState): void => {
  const role = state.role;
  const current = state.verification[role];
  state.verification[role] = {
    ...createRoleVerificationState(),
    requiredPhotos: ensurePositiveRequirement(current?.requiredPhotos),
    moderation: undefined,
  };
};

const buildMenuKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard([
    [Markup.button.callback('📸 Отправить документы', EXECUTOR_VERIFICATION_ACTION)],
    [Markup.button.callback('📨 Получить ссылку на канал', EXECUTOR_SUBSCRIPTION_ACTION)],
    [Markup.button.callback('🔄 Обновить меню', EXECUTOR_MENU_ACTION)],
  ]).reply_markup;

const formatTimestamp = (timestamp: number): string => {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
};

interface ExecutorAccessStatus {
  isVerified: boolean;
  hasActiveSubscription: boolean;
}

const determineExecutorAccessStatus = (
  ctx: BotContext,
  state: ExecutorFlowState,
): ExecutorAccessStatus => {
  const verifiedRoles = ctx.auth.executor.verifiedRoles;
  const role = state.role;
  const isVerified = Boolean(verifiedRoles[role]) || ctx.auth.executor.isVerified;

  return {
    isVerified,
    hasActiveSubscription: ctx.auth.executor.hasActiveSubscription,
  } satisfies ExecutorAccessStatus;
};

const shouldRedirectToVerification = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): boolean => {
  if (access.isVerified) {
    return false;
  }

  const verification = state.verification[state.role];
  return verification.status === 'idle';
};

const shouldRedirectToSubscription = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): boolean => {
  if (!access.isVerified || access.hasActiveSubscription) {
    return false;
  }

  return state.subscription.status === 'idle';
};

export interface ShowExecutorMenuOptions {
  skipAccessCheck?: boolean;
}

const buildVerificationSection = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): string[] => {
  const copy = getExecutorRoleCopy(state.role);

  if (access.isVerified) {
    return [
      'Статус проверки: подтверждена.',
      `Документы ${copy.genitive} успешно проверены. Можете переходить к заказам.`,
    ];
  }

  const verification = state.verification[state.role];
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

const buildSubscriptionSection = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): string[] => {
  const { subscription } = state;
  const copy = getExecutorRoleCopy(state.role);
  const channelLabel = `канал ${copy.pluralGenitive}`;

  if (!access.isVerified) {
    return [`Ссылка на ${channelLabel} станет доступна после отправки документов.`];
  }

  if (subscription.status === 'awaitingReceipt' && subscription.selectedPeriodId) {
    const period = findSubscriptionPeriodOption(subscription.selectedPeriodId);
    const label = period?.label ?? `${subscription.selectedPeriodId} дней`;
    return [
      `Выбран период подписки: ${label}.`,
      'Оплатите выбранный период и отправьте чек в этот чат для проверки.',
    ];
  }

  if (subscription.status === 'pendingModeration') {
    return ['Мы проверяем ваш чек об оплате. Ожидайте решения модератора.'];
  }

  if (access.hasActiveSubscription) {
    if (subscription.lastInviteLink) {
      const issued = subscription.lastIssuedAt
        ? ` (выдана ${formatTimestamp(subscription.lastIssuedAt)})`
        : '';
      return [
        `Ссылка на канал уже выдана${issued}. При необходимости запросите новую с помощью кнопки ниже.`,
      ];
    }

    return [
      `Подписка активна. Если нужна новая ссылка на ${channelLabel}, используйте кнопку ниже.`,
    ];
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

const buildMenuText = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): string => {
  const copy = getExecutorRoleCopy(state.role);
  const parts = [
    `${copy.emoji} Меню ${copy.genitive}`,
    '',
    ...buildVerificationSection(state, access),
    '',
    ...buildSubscriptionSection(state, access),
  ];

  return parts.join('\n');
};

export const showExecutorMenu = async (
  ctx: BotContext,
  options: ShowExecutorMenuOptions = {},
): Promise<void> => {
  if (!ctx.chat) {
    return;
  }

  const state = ensureExecutorState(ctx);
  const access = determineExecutorAccessStatus(ctx, state);

  if (!options.skipAccessCheck) {
    if (shouldRedirectToVerification(state, access)) {
      await startExecutorVerification(ctx);
      return;
    }

    if (shouldRedirectToSubscription(state, access)) {
      await startExecutorSubscription(ctx, { skipVerificationCheck: true });
      return;
    }
  }

  const text = buildMenuText(state, access);
  const keyboard = buildMenuKeyboard();
  await ui.step(ctx, {
    id: EXECUTOR_MENU_STEP_ID,
    text,
    keyboard,
    cleanup: false,
  });
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
