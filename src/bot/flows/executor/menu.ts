import { Markup, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { config } from '../../../config';
import {
  EXECUTOR_ROLES,
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type AuthExecutorState,
  type AuthUser,
  type BotContext,
  type ExecutorFlowState,
  type ExecutorRole,
  type ExecutorSubscriptionState,
  type ExecutorVerificationRoleState,
} from '../../types';
import { ui } from '../../ui';
import { startExecutorSubscription } from './subscription';
import { getExecutorRoleCopy } from '../../copy';
import { findSubscriptionPeriodOption } from './subscriptionPlans';
import {
  VERIFICATION_ALBUM_HINT,
  getVerificationRoleGuidance,
  startExecutorVerification,
} from './verification';
import { CITY_LABEL } from '../../../domain/cities';
import { CITY_ACTION_PATTERN, ensureCitySelected } from '../common/citySelect';
import { showMenu } from '../client/menu';

export const EXECUTOR_VERIFICATION_ACTION = 'executor:verification:start';
export const EXECUTOR_SUBSCRIPTION_ACTION = 'executor:subscription:link';
export const EXECUTOR_ORDERS_ACTION = 'executor:orders:link';
export const EXECUTOR_SUPPORT_ACTION = 'support:contact';
export const EXECUTOR_MENU_ACTION = 'executor:menu:refresh';
const EXECUTOR_MENU_STEP_ID = 'executor:menu:main';
export const EXECUTOR_MENU_CITY_ACTION = 'executorMenu';

export const EXECUTOR_MENU_TEXT_LABELS = {
  documents: '📸 Документы',
  subscription: '📨 Подписка/Ссылка',
  orders: '🧾 Заказы',
  support: '🆘 Поддержка',
  refresh: '🔄 Меню',
} as const;

export const EXECUTOR_MENU_TEXT_COMMANDS = Object.values(
  EXECUTOR_MENU_TEXT_LABELS,
) as readonly string[];

export const isExecutorMenuTextCommand = (value: string): boolean =>
  EXECUTOR_MENU_TEXT_COMMANDS.includes(value);

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
  lastReminderAt: undefined,
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
  lastReminderAt: typeof value?.lastReminderAt === 'number' ? value.lastReminderAt : undefined,
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

const normaliseReminderTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return undefined;
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
  lastReminderAt: normaliseReminderTimestamp(value?.lastReminderAt),
});

const isExecutorRole = (role: AuthUser['role'] | ExecutorRole | undefined): role is ExecutorRole =>
  role === 'courier' || role === 'driver';

const getSessionExecutorRole = (ctx: BotContext): ExecutorRole | undefined => {
  const sessionRole = ctx.session.executor?.role;
  if (isExecutorRole(sessionRole)) {
    return sessionRole;
  }

  return undefined;
};

const getCachedExecutorRole = (ctx: BotContext): ExecutorRole | undefined => {
  const snapshotRole = ctx.session.authSnapshot?.role;
  if (isExecutorRole(snapshotRole)) {
    return snapshotRole;
  }

  return getSessionExecutorRole(ctx);
};

export const userLooksLikeExecutor = (ctx: BotContext): boolean => {
  const authRole = ctx.auth.user.role;
  if (isExecutorRole(authRole)) {
    return true;
  }

  if (ctx.session.isAuthenticated === false && authRole === 'guest') {
    const sessionRole = getSessionExecutorRole(ctx);
    return isExecutorRole(sessionRole);
  }

  return false;
};

const deriveAuthExecutorRole = (ctx: BotContext): ExecutorRole | undefined => {
  const authRole = ctx.auth.user.role;
  if (isExecutorRole(authRole)) {
    return authRole;
  }

  if (ctx.session.isAuthenticated === false && authRole === 'guest') {
    const cachedRole = getCachedExecutorRole(ctx);
    if (isExecutorRole(cachedRole)) {
      return cachedRole;
    }
  }

  return undefined;
};

export const requireExecutorRole = (state: ExecutorFlowState): ExecutorRole => {
  const role = state.role;
  if (role && EXECUTOR_ROLES.includes(role)) {
    return role;
  }

  throw new Error('Executor role is not set in session state');
};

export const ensureExecutorState = (ctx: BotContext): ExecutorFlowState => {
  const derivedRole = deriveAuthExecutorRole(ctx);

  if (!ctx.session.executor) {
    ctx.session.executor = {
      role: derivedRole,
      verification: createDefaultVerificationState(),
      subscription: createSubscriptionState(),
    } satisfies ExecutorFlowState;
  } else {
    if (derivedRole !== undefined) {
      ctx.session.executor.role = derivedRole;
    } else if (ctx.session.isAuthenticated === false && ctx.auth.user.role === 'guest') {
      // Preserve the existing executor role when auth falls back to the guest context.
    } else {
      ctx.session.executor.role = undefined;
    }
    ctx.session.executor.verification = normaliseVerificationState(
      ctx.session.executor.verification,
    );
    ctx.session.executor.subscription = normaliseSubscriptionState(
      ctx.session.executor.subscription,
    );

    const subscription = ctx.session.executor.subscription;
    if (ctx.auth.executor.hasActiveSubscription) {
      const preserveSubscriptionFlow =
        subscription.status === 'selectingPeriod' ||
        subscription.status === 'awaitingReceipt' ||
        subscription.status === 'pendingModeration';

      if (!preserveSubscriptionFlow) {
        if (subscription.status !== 'idle') {
          subscription.status = 'idle';
        }

        subscription.selectedPeriodId = undefined;
        subscription.pendingPaymentId = undefined;
      }
    } else {
      subscription.lastInviteLink = undefined;
      subscription.lastIssuedAt = undefined;
    }
  }

  return ctx.session.executor;
};

export const resetVerificationState = (state: ExecutorFlowState): void => {
  const role = state.role;
  if (!role || !EXECUTOR_ROLES.includes(role)) {
    return;
  }
  const current = state.verification[role];
  state.verification[role] = {
    ...createRoleVerificationState(),
    requiredPhotos: ensurePositiveRequirement(current?.requiredPhotos),
    moderation: undefined,
  };
};

const buildMenuKeyboard = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): InlineKeyboardMarkup => {
  if (access.isVerified && access.hasActiveSubscription) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Заказы', EXECUTOR_ORDERS_ACTION)],
      [Markup.button.callback('Связаться с поддержкой', EXECUTOR_SUPPORT_ACTION)],
    ]).reply_markup;
  }

  if (!access.isVerified) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('📨 Получить ссылку на канал', EXECUTOR_SUBSCRIPTION_ACTION)],
      [Markup.button.callback('🔄 Обновить меню', EXECUTOR_MENU_ACTION)],
    ]).reply_markup;
  }

  return Markup.inlineKeyboard([
    [Markup.button.callback('📨 Получить ссылку на канал', EXECUTOR_SUBSCRIPTION_ACTION)],
    [Markup.button.callback('🔄 Обновить меню', EXECUTOR_MENU_ACTION)],
  ]).reply_markup;
};

const formatTimestamp = (timestamp: number): string => {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: config.timezone,
  }).format(new Date(timestamp));
};

interface ExecutorAccessStatus {
  isVerified: boolean;
  hasActiveSubscription: boolean;
}

const hasRoleVerificationFlags = (verifiedRoles: AuthExecutorState['verifiedRoles']): boolean =>
  EXECUTOR_ROLES.some((role) => Boolean(verifiedRoles[role]));

export const isExecutorRoleVerified = (ctx: BotContext, role: ExecutorRole): boolean => {
  const verifiedRoles = ctx.auth.executor.verifiedRoles;

  if (Boolean(verifiedRoles[role])) {
    return true;
  }

  if (!hasRoleVerificationFlags(verifiedRoles)) {
    return ctx.auth.executor.isVerified;
  }

  return false;
};

const determineExecutorAccessStatus = (
  ctx: BotContext,
  state: ExecutorFlowState,
): ExecutorAccessStatus => {
  const role = requireExecutorRole(state);
  const isVerified = isExecutorRoleVerified(ctx, role);

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

  const role = requireExecutorRole(state);
  const verification = state.verification[role];
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
  const role = requireExecutorRole(state);
  const copy = getExecutorRoleCopy(role);
  const guidance = getVerificationRoleGuidance(role);

  if (access.isVerified) {
    return [
      'Статус проверки: подтверждена.',
      `Документы ${copy.genitive} подтверждены. Мы активировали бесплатный доступ на 2 дня сразу после одобрения.`,
      'Оформите подписку, чтобы сохранить доступ после пробного периода — используйте кнопку «📨 Получить ссылку на канал».',
    ];
  }

  const verification = state.verification[role];
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
        return `${guidance.idlePrompt} ${VERIFICATION_ALBUM_HINT}`;
      case 'collecting':
        return `${guidance.collectingPrompt} ${VERIFICATION_ALBUM_HINT}`;
      case 'submitted':
        return 'Мы передали документы модераторам. После одобрения выдадим доступ автоматически.';
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
  const role = requireExecutorRole(state);
  const copy = getExecutorRoleCopy(role);
  const channelLabel = `канал ${copy.pluralGenitive}`;

  if (!access.isVerified) {
    return [
      `Ссылка на ${channelLabel} станет доступна после отправки документов. После подтверждения мы автоматически откроем бесплатный доступ на 2 дня и пришлём ссылку.`,
    ];
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
        `Ссылка на канал уже выдана${issued}. При необходимости запросите новую с помощью кнопки «Заказы» ниже.`,
      ];
    }

    return [
      `Подписка активна. Если нужна новая ссылка на ${channelLabel}, используйте кнопку «Заказы» ниже.`,
    ];
  }

  return [
    `Получите ссылку на ${channelLabel}: после подтверждения документов мы выдадим 2-дневный пробный доступ, затем выберите подписку через кнопку ниже, чтобы остаться в канале.`,
  ];
};

const buildNextStepsSection = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
): string[] => {
  const role = requireExecutorRole(state);
  const copy = getExecutorRoleCopy(role);
  const guidance = getVerificationRoleGuidance(role);

  if (!access.isVerified) {
    return [
      `${guidance.nextStepsPrompt} ${VERIFICATION_ALBUM_HINT}`,
      'Дождитесь решения модератора — уведомление придёт в этот чат.',
      'После одобрения автоматически активируется 2-дневный бесплатный доступ, затем оформите подписку через «📨 Получить ссылку на канал».',
    ];
  }

  if (!access.hasActiveSubscription) {
    if (state.subscription.status === 'awaitingReceipt') {
      return [
        'Оплатите выбранный период подписки по реквизитам Kaspi.',
        'Пришлите чек сюда, чтобы модератор подтвердил оплату и выдал ссылку.',
      ];
    }

    if (state.subscription.status === 'pendingModeration') {
      return [
        'Мы проверяем ваш чек. Как только модератор подтвердит оплату, вы получите ссылку.',
      ];
    }

    return [
      'Откройте «📨 Получить ссылку на канал» и выберите период подписки.',
      'Оплатите подписку и отправьте чек в этот чат — модератор выдаст ссылку.',
      `После подтверждения ссылка на канал ${copy.pluralGenitive} появится в меню «Заказы».`,
    ];
  }

  return [
    'Нажмите «Заказы», чтобы получить актуальную ссылку и смотреть задания.',
    'Если возникнут вопросы — используйте кнопку «🆘 Поддержка».',
  ];
};

const buildMenuText = (
  state: ExecutorFlowState,
  access: ExecutorAccessStatus,
  cityLabel: string,
  user: AuthUser,
): string => {
  const role = requireExecutorRole(state);
  const copy = getExecutorRoleCopy(role);

  const statusLines: string[] = [];
  if (user.trialEndsAt && Number.isFinite(user.trialEndsAt.getTime())) {
    const msLeft = user.trialEndsAt.getTime() - Date.now();
    if (msLeft > 0) {
      const daysLeft = Math.max(1, Math.ceil(msLeft / 86_400_000));
      statusLines.push(
        `🧪 Пробный до ${user.trialEndsAt.toLocaleDateString('ru-RU')} (осталось ${daysLeft} дн.)`,
      );
    }
  }

  const verification = state.verification[role];
  const uploadedPhotos = verification.uploadedPhotos.length;
  const requiredPhotos = ensurePositiveRequirement(verification.requiredPhotos);
  const verificationStatusLabel =
    verification.status === 'submitted'
      ? 'проверка'
      : verification.status === 'collecting'
        ? 'ожидаем'
        : 'не начаты';
  statusLines.push(`🛡️ Документы: ${verificationStatusLabel} ${uploadedPhotos}/${requiredPhotos}`);

  if (access.hasActiveSubscription) {
    statusLines.push('📨 Подписка: активна');
  } else if (access.isVerified) {
    statusLines.push('📨 Подписка: нужна оплата');
  } else {
    statusLines.push('📨 Подписка: после проверки');
  }

  const parts = [`${copy.emoji} Меню ${copy.genitive}`, `🏙️ Город: ${cityLabel}`];
  if (statusLines.length > 0) {
    parts.push(...statusLines);
  }

  parts.push(
    '',
    ...buildVerificationSection(state, access),
    '',
    ...buildSubscriptionSection(state, access),
  );

  const nextSteps = buildNextStepsSection(state, access);
  if (nextSteps.length > 0) {
    parts.push('', '👉 Что дальше:');
    nextSteps.forEach((step, index) => {
      parts.push(`${index + 1}. ${step}`);
    });
  }

  return parts.join('\n');
};

export const showExecutorMenu = async (
  ctx: BotContext,
  options: ShowExecutorMenuOptions = {},
): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  const uiState = ctx.session.ui;
  uiState.pendingCityAction = EXECUTOR_MENU_CITY_ACTION;

  const city = await ensureCitySelected(ctx, 'Выберите город, чтобы получить доступ к заказам.');
  if (!city) {
    return;
  }

  uiState.pendingCityAction = undefined;

  const state = ensureExecutorState(ctx);
  if (!state.role || !EXECUTOR_ROLES.includes(state.role)) {
    return;
  }
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

  const text = buildMenuText(state, access, CITY_LABEL[city], ctx.auth.user);
  const keyboard = buildMenuKeyboard(state, access);

  await ui.step(ctx, {
    id: EXECUTOR_MENU_STEP_ID,
    text,
    keyboard,
    cleanup: false,
  });
};

export const registerExecutorMenu = (bot: Telegraf<BotContext>): void => {
  bot.action(CITY_ACTION_PATTERN, async (ctx, next) => {
    if (ctx.chat?.type !== 'private') {
      if (typeof next === 'function') {
        await next();
      }
      return;
    }

    if (typeof next === 'function') {
      await next();
    }

    if (ctx.chat?.type !== 'private') {
      return;
    }

    const pendingCityAction = ctx.session.ui?.pendingCityAction;
    const shouldShowExecutorMenu =
      pendingCityAction === EXECUTOR_MENU_CITY_ACTION ||
      (!pendingCityAction && userLooksLikeExecutor(ctx));

    if (!shouldShowExecutorMenu) {
      return;
    }

    ensureExecutorState(ctx);
    await showExecutorMenu(ctx);
  });

  bot.action(EXECUTOR_MENU_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    if (!userLooksLikeExecutor(ctx)) {
      await ctx.answerCbQuery();
      await showMenu(ctx);
      return;
    }

    await ctx.answerCbQuery();
    ensureExecutorState(ctx);
    await showExecutorMenu(ctx);
  });

  bot.command('menu', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return;
    }

    const looksLikeExecutor = userLooksLikeExecutor(ctx);
    const cachedExecutorRole =
      !looksLikeExecutor &&
      ctx.session.isAuthenticated === false &&
      ctx.auth.user.role === 'guest'
        ? getCachedExecutorRole(ctx)
        : undefined;

    if (!looksLikeExecutor && !cachedExecutorRole) {
      await showMenu(ctx);
      return;
    }

    ensureExecutorState(ctx);
    await showExecutorMenu(ctx);
  });

  bot.hears(EXECUTOR_MENU_TEXT_LABELS.refresh, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return;
    }

    if (!userLooksLikeExecutor(ctx)) {
      await showMenu(ctx);
      return;
    }

    ensureExecutorState(ctx);
    await showExecutorMenu(ctx);
  });
};
