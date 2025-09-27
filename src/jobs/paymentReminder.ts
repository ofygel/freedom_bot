import cron, { type ScheduledTask } from 'node-cron';
import type { Telegraf } from 'telegraf';

import { ui } from '../bot/ui';
import { ensureExecutorState, showExecutorMenu } from '../bot/flows/executor/menu';
import { loadAuthStateByTelegramId } from '../bot/middlewares/auth';
import type { BotContext, SessionState } from '../bot/types';
import { config, logger } from '../config';
import type { PoolClient } from '../db/client';
import { pool } from '../db/client';
import { loadSessionState, saveSessionState, type SessionKey } from '../db/sessions';

type ReminderReason = 'awaitingReceipt' | 'trialEnding';

interface ReminderDescriptor {
  reasons: Set<ReminderReason>;
  trialEndsAt?: Date;
}

interface ReminderCandidate extends ReminderDescriptor {
  key: SessionKey;
  session: SessionState;
}

const REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;
const TRIAL_WINDOW_MS = 2 * 60 * 60 * 1000;
const REMINDER_STEP_ID = 'executor:subscription:reminder';

const parseScopeId = (value: string | number | null | undefined): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }

  return null;
};

const parseTimestamp = (value: Date | string | null | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value;
  }

  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return undefined;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseReminderTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  return undefined;
};

const gatherReminderDescriptors = async (
  client: PoolClient,
  now: Date,
): Promise<Map<string, ReminderDescriptor>> => {
  const descriptors = new Map<string, ReminderDescriptor>();

  const awaiting = await client.query<{ scope_id: string | number | null }>(
    `
      SELECT scope_id
      FROM sessions
      WHERE scope = 'chat'
        AND state->'executor'->'subscription'->>'status' = 'awaitingReceipt'
    `,
  );

  for (const row of awaiting.rows) {
    const scopeId = parseScopeId(row.scope_id);
    if (!scopeId) {
      continue;
    }

    const descriptor = descriptors.get(scopeId) ?? { reasons: new Set<ReminderReason>() };
    descriptor.reasons.add('awaitingReceipt');
    descriptors.set(scopeId, descriptor);
  }

  const trialDeadline = new Date(now.getTime() + TRIAL_WINDOW_MS);
  const trialRows = await client.query<{
    scope_id: string | number | null;
    trial_ends_at: Date | string | null;
  }>(
    `
      SELECT s.scope_id, u.trial_ends_at
      FROM sessions s
      JOIN users u ON u.tg_id = s.scope_id
      WHERE s.scope = 'chat'
        AND u.role = ANY($3::user_role[])
        AND u.trial_ends_at IS NOT NULL
        AND u.trial_ends_at > $1
        AND u.trial_ends_at <= $2
    `,
    [now, trialDeadline, ['courier', 'driver']],
  );

  for (const row of trialRows.rows) {
    const scopeId = parseScopeId(row.scope_id);
    if (!scopeId) {
      continue;
    }

    const trialEndsAt = parseTimestamp(row.trial_ends_at);
    if (!trialEndsAt) {
      continue;
    }

    const descriptor = descriptors.get(scopeId) ?? { reasons: new Set<ReminderReason>() };
    descriptor.reasons.add('trialEnding');
    descriptor.trialEndsAt = trialEndsAt;
    descriptors.set(scopeId, descriptor);
  }

  return descriptors;
};

const loadReminderCandidates = async (
  client: PoolClient,
  descriptors: Map<string, ReminderDescriptor>,
): Promise<ReminderCandidate[]> => {
  const candidates: ReminderCandidate[] = [];

  for (const [scopeId, descriptor] of descriptors.entries()) {
    const key: SessionKey = { scope: 'chat', scopeId };
    try {
      const session = await loadSessionState(client, key);
      if (!session) {
        continue;
      }

      if (!session.executor || !session.executor.subscription) {
        continue;
      }

      candidates.push({
        key,
        session,
        reasons: new Set(descriptor.reasons),
        trialEndsAt: descriptor.trialEndsAt,
      });
    } catch (error) {
      logger.error({ err: error, scopeId }, 'Failed to load session for payment reminder');
    }
  }

  return candidates;
};

const determineEffectiveReasons = (
  candidate: ReminderCandidate,
  now: Date,
): Set<ReminderReason> => {
  const reasons = new Set<ReminderReason>();
  const subscription = candidate.session.executor?.subscription;
  if (!subscription) {
    return reasons;
  }

  if (
    candidate.reasons.has('awaitingReceipt') &&
    subscription.status === 'awaitingReceipt'
  ) {
    reasons.add('awaitingReceipt');
  }

  if (candidate.reasons.has('trialEnding')) {
    const trialEndsAt = candidate.trialEndsAt;
    if (trialEndsAt && trialEndsAt.getTime() > now.getTime()) {
      reasons.add('trialEnding');
    }
  }

  return reasons;
};

const formatDateTime = (date: Date): string =>
  new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: config.timezone,
  }).format(date);

const buildReminderMessage = (
  reasons: Set<ReminderReason>,
  trialEndsAt?: Date,
): string => {
  const lines: string[] = [];

  if (reasons.has('awaitingReceipt')) {
    lines.push(
      '💸 Мы всё ещё ожидаем чек об оплате.',
      'Отправьте чек в этот чат, чтобы мы подтвердили оплату и выдали ссылку на канал.',
    );
  }

  if (reasons.has('trialEnding') && trialEndsAt) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(
      '🕑 Пробный период скоро закончится.',
      `Доступ будет отключён ${formatDateTime(trialEndsAt)}. Оформите подписку заранее, чтобы не потерять доступ.`,
    );
  }

  if (lines.length === 0) {
    return '';
  }

  lines.push(
    '',
    'Мы обновили меню ниже — используйте кнопку «📨 Получить ссылку на канал», чтобы завершить оплату.',
  );

  return lines.join('\n');
};

const sendReminder = async (
  bot: Telegraf<BotContext>,
  candidate: ReminderCandidate,
  reasons: Set<ReminderReason>,
  now: Date,
): Promise<void> => {
  const chatId = Number.parseInt(candidate.key.scopeId, 10);
  if (!Number.isFinite(chatId)) {
    logger.warn({ scopeId: candidate.key.scopeId }, 'Skipping reminder, invalid chat identifier');
    return;
  }

  let auth;
  try {
    auth = await loadAuthStateByTelegramId(chatId);
  } catch (error) {
    logger.error({ err: error, chatId }, 'Failed to load auth state for payment reminder');
    return;
  }

  const session = candidate.session;
  session.ui = session.ui ?? {
    steps: {},
    homeActions: [],
    pendingCityAction: undefined,
    clientMenuVariant: undefined,
  };

  const ctx = {
    chat: { id: chatId, type: 'private' as const },
    from: { id: chatId } as NonNullable<BotContext['from']>,
    session,
    auth,
    telegram: bot.telegram,
    reply: (text: string, extra?: Parameters<typeof bot.telegram.sendMessage>[2]) =>
      bot.telegram.sendMessage(chatId, text, extra),
    answerCbQuery: async () => undefined,
  } as unknown as BotContext;

  ensureExecutorState(ctx);

  const message = buildReminderMessage(reasons, candidate.trialEndsAt);
  if (message) {
    await ui.step(ctx, {
      id: REMINDER_STEP_ID,
      text: message,
      cleanup: false,
    });
  }

  await showExecutorMenu(ctx, { skipAccessCheck: true });

  const subscription = ctx.session.executor.subscription;
  subscription.lastReminderAt = now.getTime();

  await saveSessionState(pool, candidate.key, ctx.session);
  logger.info(
    { chatId, reasons: Array.from(reasons), trialEndsAt: candidate.trialEndsAt?.toISOString() },
    'Sent executor payment reminder',
  );
};

const executeReminderCycle = async (
  bot: Telegraf<BotContext>,
  now = new Date(),
): Promise<void> => {
  const client = await pool.connect();
  let candidates: ReminderCandidate[] = [];
  try {
    const descriptors = await gatherReminderDescriptors(client, now);
    candidates = await loadReminderCandidates(client, descriptors);
  } catch (error) {
    logger.error({ err: error }, 'Failed to prepare payment reminder candidates');
  } finally {
    client.release();
  }

  for (const candidate of candidates) {
    const reasons = determineEffectiveReasons(candidate, now);
    if (reasons.size === 0) {
      continue;
    }

    const subscription = candidate.session.executor?.subscription;
    if (!subscription) {
      continue;
    }

    const lastReminderAt = parseReminderTimestamp(subscription.lastReminderAt);
    if (
      lastReminderAt !== undefined &&
      now.getTime() - lastReminderAt < REMINDER_INTERVAL_MS
    ) {
      continue;
    }

    try {
      await sendReminder(bot, candidate, reasons, now);
    } catch (error) {
      logger.error(
        { err: error, chatId: candidate.key.scopeId },
        'Failed to send payment reminder',
      );
    }
  }
};

let task: ScheduledTask | null = null;
let running = false;

const runSafely = (bot: Telegraf<BotContext>): void => {
  if (running) {
    logger.warn('Payment reminder task is already running, skipping this tick');
    return;
  }

  running = true;
  void executeReminderCycle(bot)
    .catch((error) => {
      logger.error({ err: error }, 'Unhandled payment reminder error');
    })
    .finally(() => {
      running = false;
    });
};

export const startPaymentReminderJob = (bot: Telegraf<BotContext>): void => {
  if (task) {
    return;
  }

  task = cron.schedule(
    config.jobs.paymentReminder,
    () => runSafely(bot),
    { timezone: config.timezone },
  );
};

export const stopPaymentReminderJob = (): void => {
  if (!task) {
    return;
  }

  task.stop();
  task = null;
  running = false;
};

export const __testing__ = {
  executeReminderCycle,
  REMINDER_INTERVAL_MS,
};
