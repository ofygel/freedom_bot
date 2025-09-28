import cron, { type ScheduledTask } from 'node-cron';
import type { Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import type { BotContext } from '../bot/types';
import { CLIENT_MENU_ACTION } from '../bot/flows/client/menu';
import { EXECUTOR_MENU_ACTION } from '../bot/flows/executor/menu';
import { buildInlineKeyboard } from '../bot/keyboards/common';
import { wrapCallbackData } from '../bot/services/callbackTokens';
import { config, logger } from '../config';
import { pool } from '../db';
import { markNudged, type SessionKey } from '../db/sessions';
import { copy } from '../bot/copy';

interface PendingSessionRow {
  scope: string;
  scope_id: string;
  flow_state: string | null;
  flow_payload: unknown;
  role: string | null;
  keyboard_nonce: string | null;
}

interface FlowRecoveryShape {
  type: string;
  payload?: unknown;
}

interface FlowPayloadShape {
  homeAction?: string | null;
  recovery?: FlowRecoveryShape;
}

const secret = config.bot.callbackSignSecret ?? config.bot.token;
const BATCH_LIMIT = 100;
const MIN_INACTIVITY_SECONDS = 90;

const resolveInactivityThreshold = (): number =>
  Math.max(config.jobs.nudgerInactivitySeconds, MIN_INACTIVITY_SECONDS);

const fetchPendingSessions = async (): Promise<PendingSessionRow[]> => {
  const { rows } = await pool.query<PendingSessionRow>(
    `
      SELECT
        s.scope,
        s.scope_id::text AS scope_id,
        s.flow_state,
        s.flow_payload,
        COALESCE(u.last_menu_role, u.role) AS role,
        u.keyboard_nonce
      FROM sessions s
      LEFT JOIN users u ON s.scope = 'chat' AND u.tg_id = s.scope_id
      WHERE s.scope = 'chat'
        AND s.last_step_at IS NOT NULL
        AND s.last_step_at <= now() - ($1::int * INTERVAL '1 second')
        AND (s.nudge_sent_at IS NULL OR s.nudge_sent_at < s.last_step_at)
      ORDER BY s.last_step_at ASC
      LIMIT $2
    `,
    [resolveInactivityThreshold(), BATCH_LIMIT],
  );

  return rows;
};

const parseFlowPayload = (value: unknown): FlowPayloadShape => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const homeAction = typeof candidate.homeAction === 'string' ? candidate.homeAction : null;
  const recoveryCandidate = candidate.recovery;
  let recovery: FlowRecoveryShape | undefined;
  if (recoveryCandidate && typeof recoveryCandidate === 'object') {
    const recoveryObject = recoveryCandidate as Record<string, unknown>;
    const type = typeof recoveryObject.type === 'string' ? recoveryObject.type : undefined;
    if (type) {
      recovery = { type, payload: recoveryObject.payload };
    }
  }

  return {
    homeAction: homeAction ?? undefined,
    recovery,
  };
};

const bindAction = (
  action: string,
  userId: string | null,
  keyboardNonce: string | null,
): string => {
  if (!userId || !keyboardNonce) {
    return action;
  }

  return wrapCallbackData(action, {
    secret,
    userId,
    keyboardNonce,
    bindToUser: true,
    ttlSeconds: config.bot.callbackTtlSeconds,
  });
};

const buildNudgeKeyboard = (
  payload: FlowPayloadShape,
  role: string | null,
  userId: string | null,
  keyboardNonce: string | null,
): InlineKeyboardMarkup | undefined => {
  const rows: { label: string; action: string }[][] = [];

  if (payload.homeAction) {
    rows.push([
      {
        label: copy.resume,
        action: bindAction(payload.homeAction, userId, keyboardNonce),
      },
    ]);
  }

  let fallbackAction: string | null = null;
  if (role === 'executor' || role === 'moderator') {
    fallbackAction = EXECUTOR_MENU_ACTION;
  } else if (role === 'client' || role === 'guest') {
    fallbackAction = CLIENT_MENU_ACTION;
  }

  if (fallbackAction) {
    rows.push([
      {
        label: copy.home,
        action: bindAction(fallbackAction, userId, keyboardNonce),
      },
    ]);
  }

  if (rows.length === 0) {
    return undefined;
  }

  return buildInlineKeyboard(rows);
};

let task: ScheduledTask | null = null;

const buildSessionKey = (row: PendingSessionRow): SessionKey | null => {
  if (row.scope !== 'chat') {
    return null;
  }

  const scopeId = row.scope_id?.trim();
  if (!scopeId) {
    return null;
  }

  return { scope: 'chat', scopeId };
};

const deliverNudge = async (bot: Telegraf<BotContext>, row: PendingSessionRow): Promise<void> => {
  const sessionKey = buildSessionKey(row);
  if (!sessionKey) {
    logger.debug({ job: 'nudger', scope: row.scope }, 'inactivity_nudger_skipped_scope');
    return;
  }

  const payload = parseFlowPayload(row.flow_payload);
  const keyboard = buildNudgeKeyboard(
    payload,
    row.role,
    sessionKey.scopeId,
    row.keyboard_nonce,
  );

  if (!keyboard) {
    logger.debug(
      { job: 'nudger', scope: sessionKey.scope, scopeId: sessionKey.scopeId },
      'inactivity_nudger_no_keyboard',
    );
    return;
  }

  try {
    await bot.telegram.sendMessage(sessionKey.scopeId, copy.inactivityNudge, {
      reply_markup: keyboard,
      disable_notification: true,
    });
  } catch (error) {
    logger.error(
      { err: error, job: 'nudger', scope: sessionKey.scope, scopeId: sessionKey.scopeId },
      'inactivity_nudge_delivery_failed',
    );
    return;
  }

  try {
    await markNudged(pool, sessionKey);
  } catch (error) {
    logger.error(
      { err: error, job: 'nudger', scope: sessionKey.scope, scopeId: sessionKey.scopeId },
      'inactivity_nudge_mark_failed',
    );
    return;
  }

  logger.info(
    {
      job: 'nudger',
      scope: sessionKey.scope,
      scopeId: sessionKey.scopeId,
      flowState: row.flow_state,
      role: row.role,
    },
    'inactivity_nudge_sent',
  );
};

const runNudgerTick = async (bot: Telegraf<BotContext>): Promise<void> => {
  let sessions: PendingSessionRow[];
  try {
    sessions = await fetchPendingSessions();
  } catch (error) {
    logger.error({ err: error, job: 'nudger' }, 'inactivity_nudger_query_failed');
    return;
  }

  if (sessions.length === 0) {
    return;
  }

  logger.debug(
    { job: 'nudger', pending: sessions.length },
    'inactivity_nudger_pending_sessions',
  );

  for (const session of sessions) {
    // Run sequentially to avoid overwhelming Telegram with bursts.
    // eslint-disable-next-line no-await-in-loop
    await deliverNudge(bot, session);
  }
};

export const startInactivityNudger = (bot: Telegraf<BotContext>): void => {
  if (!config.features.nudgerEnabled) {
    stopInactivityNudger();
    logger.info({ job: 'nudger' }, 'inactivity_nudger_feature_disabled');
    return;
  }

  if (!config.jobs.nudgerEnabled) {
    stopInactivityNudger();
    logger.info({ job: 'nudger' }, 'inactivity_nudger_disabled');
    return;
  }

  if (task) {
    return;
  }

  task = cron.schedule(
    config.jobs.nudger,
    () => {
      void runNudgerTick(bot);
    },
    { timezone: config.timezone },
  );

  logger.info(
    {
      job: 'nudger',
      cron: config.jobs.nudger,
      inactivitySeconds: resolveInactivityThreshold(),
    },
    'inactivity_nudger_started',
  );
};

export const stopInactivityNudger = (): void => {
  if (!task) {
    return;
  }

  task.stop();
  task = null;

  logger.info({ job: 'nudger' }, 'inactivity_nudger_stopped');
};
