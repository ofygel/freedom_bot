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
  if (role === 'courier' || role === 'driver') {
    fallbackAction = EXECUTOR_MENU_ACTION;
  } else if (role === 'client' || role === 'moderator') {
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

export const startInactivityNudger = (bot: Telegraf<BotContext>): void => {
  if (task) {
    return;
  }

  task = cron.schedule('*/30 * * * * *', async () => {
    try {
      const { rows } = await pool.query<PendingSessionRow>(
        `
          SELECT s.scope, s.scope_id, s.flow_state, s.flow_payload, u.role, u.keyboard_nonce
          FROM sessions s
          LEFT JOIN users u ON u.tg_id = s.scope_id
          WHERE s.scope = 'chat'
            AND s.flow_state IS NOT NULL
            AND s.last_step_at IS NOT NULL
            AND (s.nudge_sent_at IS NULL OR s.nudge_sent_at < s.last_step_at)
            AND s.last_step_at < now() - interval '90 seconds'
          ORDER BY s.last_step_at
          LIMIT 20
        `,
      );

      for (const row of rows) {
        const key = buildSessionKey(row);
        if (!key) {
          continue;
        }

        const chatIdNumber = Number(row.scope_id);
        if (!Number.isFinite(chatIdNumber) || chatIdNumber <= 0) {
          await markNudged(pool, key);
          continue;
        }

        const payload = parseFlowPayload(row.flow_payload);
        const keyboard = buildNudgeKeyboard(payload, row.role, row.scope_id, row.keyboard_nonce);
        if (!keyboard) {
          await markNudged(pool, key);
          continue;
        }

        try {
          await bot.telegram.sendMessage(chatIdNumber, copy.nudge, {
            reply_markup: keyboard,
          });
        } catch (error) {
          logger.debug({ err: error, chatId: chatIdNumber }, 'Failed to send inactivity nudge');
        } finally {
          try {
            await markNudged(pool, key);
          } catch (markError) {
            logger.debug({ err: markError, scope: key.scope, scopeId: key.scopeId }, 'Failed to mark nudge sent');
          }
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Inactivity nudger tick failed');
    }
  });
};

export const stopInactivityNudger = (): void => {
  if (!task) {
    return;
  }

  task.stop();
  task = null;
};
