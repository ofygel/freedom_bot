import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { hasUsersCitySelectedColumn, pool } from '../../db';
import { isAppCity } from '../../domain/cities';
import {
  EXECUTOR_ROLES,
  type AuthExecutorState,
  type AuthState,
  type BotContext,
  type ExecutorRole,
  type UserRole,
  type UserMenuRole,
  type UserStatus,
} from '../types';

type Nullable<T> = T | null | undefined;

interface AuthQueryRow {
  tg_id: string | number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string | null;
  status: string | null;
  is_verified: boolean | null;
  is_blocked: boolean | null;
  courier_verified: boolean | null;
  driver_verified: boolean | null;
  has_active_subscription: boolean | null;
  city_selected?: string | null;
  verified_at?: string | Date | null;
  trial_ends_at?: string | Date | null;
  last_menu_role?: string | null;
  keyboard_nonce?: string | null;
}

const parseNumericId = (value: string | number): number => {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Failed to parse numeric identifier: ${value}`);
  }

  return parsed;
};

const normaliseString = (value: Nullable<string>): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normaliseRole = (value: Nullable<string>): UserRole => {
  switch (value) {
    case 'courier':
    case 'driver':
    case 'moderator':
      return value;
    case 'client':
    default:
      return 'client';
  }
};

const normaliseStatus = (value: Nullable<string>): UserStatus => {
  switch (value) {
    case 'onboarding':
    case 'awaiting_phone':
    case 'active_client':
    case 'active_executor':
    case 'trial_expired':
    case 'suspended':
    case 'banned':
      return value;
    case 'guest':
    default:
      return 'guest';
  }
};

const normaliseMenuRole = (value: Nullable<string>): UserMenuRole | undefined => {
  switch (value) {
    case 'client':
    case 'courier':
    case 'moderator':
      return value;
    default:
      return undefined;
  }
};

const parseTimestamp = (value: Nullable<string | Date>): Date | undefined => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return new Date(value);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return undefined;
  }

  return parsed;
};

const buildVerifiedMap = (row: AuthQueryRow): Record<ExecutorRole, boolean> => ({
  courier: Boolean(row.courier_verified),
  driver: Boolean(row.driver_verified),
});

const buildExecutorState = (row: AuthQueryRow): AuthExecutorState => {
  const verifiedRoles = buildVerifiedMap(row);
  const isVerified = Boolean(row.is_verified) || EXECUTOR_ROLES.some((role) => verifiedRoles[role]);

  return {
    verifiedRoles,
    hasActiveSubscription: Boolean(row.has_active_subscription),
    isVerified,
  } satisfies AuthExecutorState;
};

const deriveUserStatus = (row: AuthQueryRow, status: UserStatus): UserStatus => {
  if (status === 'trial_expired' || status === 'suspended' || status === 'banned') {
    return status;
  }

  if (row.is_blocked) {
    return 'suspended';
  }

  const role = normaliseRole(row.role);
  const hasPhone = Boolean(normaliseString(row.phone));

  if (!hasPhone) {
    return 'awaiting_phone';
  }

  if (status === 'active_executor') {
    return 'active_executor';
  }

  const hasExecutorAccess =
    role === 'courier' || role === 'driver' ? Boolean(row.has_active_subscription) : false;

  if (hasExecutorAccess) {
    return 'active_executor';
  }

  return 'active_client';
};

const buildAuthQuery = (includeCitySelected: boolean): string => `
      WITH upsert AS (
        INSERT INTO users (tg_id, username, first_name, last_name, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (tg_id) DO UPDATE
        SET
          username = COALESCE(EXCLUDED.username, users.username),
          first_name = COALESCE(EXCLUDED.first_name, users.first_name),
          last_name = COALESCE(EXCLUDED.last_name, users.last_name),
          updated_at = now()
        RETURNING
          tg_id,
          username,
          first_name,
          last_name,
          phone,
          role,
          status,
          is_verified,
          is_blocked${includeCitySelected ? ',\n          city_selected' : ''},
          verified_at,
          trial_ends_at,
          last_menu_role,
          keyboard_nonce
      )
      SELECT
        u.tg_id,
        u.username,
        u.first_name,
        u.last_name,
        u.phone,
        u.role,
        u.status,
        u.is_verified,
        u.is_blocked${includeCitySelected ? ',\n        u.city_selected' : ''},
        u.verified_at,
        u.trial_ends_at,
        u.last_menu_role,
        u.keyboard_nonce,
        COALESCE(cv.is_verified, false) AS courier_verified,
        COALESCE(dv.is_verified, false) AS driver_verified,
        COALESCE(sub.has_active_subscription, false) AS has_active_subscription
      FROM upsert u
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
          FROM verifications v
          WHERE v.user_id = u.tg_id
            AND v.role = 'courier'
            AND v.status = 'active'
            AND (v.expires_at IS NULL OR v.expires_at > now())
        ) AS is_verified
      ) cv ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
          FROM verifications v
          WHERE v.user_id = u.tg_id
            AND v.role = 'driver'
            AND v.status = 'active'
            AND (v.expires_at IS NULL OR v.expires_at > now())
        ) AS is_verified
      ) dv ON true
      LEFT JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1
          FROM channels c
          JOIN subscriptions s ON s.chat_id = c.drivers_channel_id
          WHERE c.id = 1
            AND c.drivers_channel_id IS NOT NULL
            AND s.user_id = u.tg_id
            AND s.status = 'active'
            AND COALESCE(s.grace_until, s.next_billing_at) > now()
        ) AS has_active_subscription
      ) sub ON true
    `;

const mapAuthRow = (row: AuthQueryRow): AuthState => {
  const telegramId = parseNumericId(row.tg_id);
  const executor = buildExecutorState(row);
  const role = normaliseRole(row.role);
  const status = deriveUserStatus(row, normaliseStatus(row.status));

  return {
    user: {
      telegramId,
      username: normaliseString(row.username),
      firstName: normaliseString(row.first_name),
      lastName: normaliseString(row.last_name),
      phone: normaliseString(row.phone),
      role,
      status,
      isVerified: Boolean(row.is_verified),
      isBlocked: Boolean(row.is_blocked),
      citySelected: isAppCity(row.city_selected)
        ? row.city_selected
        : undefined,
      verifiedAt: parseTimestamp(row.verified_at),
      trialEndsAt: parseTimestamp(row.trial_ends_at),
      lastMenuRole: normaliseMenuRole(row.last_menu_role),
      keyboardNonce: normaliseString(row.keyboard_nonce),
    },
    executor,
    isModerator: role === 'moderator',
  } satisfies AuthState;
};

const loadAuthState = async (
  from: NonNullable<BotContext['from']>,
): Promise<AuthState> => {
  const includeCitySelected = await hasUsersCitySelectedColumn();
  const authQuery = buildAuthQuery(includeCitySelected);

  const { rows } = await pool.query<AuthQueryRow>(authQuery, [
    from.id,
    from.username ?? null,
    from.first_name ?? null,
    from.last_name ?? null,
  ]);

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to load authentication context');
  }

  return mapAuthRow(row);
};

const applyAuthState = (ctx: BotContext, authState: AuthState): void => {
  ctx.auth = authState;
  ctx.session.isAuthenticated = true;
  ctx.session.user = {
    id: authState.user.telegramId,
    username: authState.user.username,
    firstName: authState.user.firstName,
    lastName: authState.user.lastName,
  };
  if (authState.user.phone && !ctx.session.phoneNumber) {
    ctx.session.phoneNumber = authState.user.phone;
  }
  if (authState.user.citySelected && !ctx.session.city) {
    ctx.session.city = authState.user.citySelected;
  }
};

type ChatWithType = Nullable<{ type?: string }>;

const isChannelChat = (chat: ChatWithType): boolean => chat?.type === 'channel';

const hasChannelSender = (sender: ChatWithType): boolean => sender?.type === 'channel';

const isChannelUpdate = (ctx: BotContext): boolean => {
  const update = ctx.update as {
    channel_post?: { chat?: { type?: string } };
    edited_channel_post?: { chat?: { type?: string } };
    message?: { chat?: { type?: string }; sender_chat?: { type?: string } };
    edited_message?: { chat?: { type?: string }; sender_chat?: { type?: string } };
  };

  if ('channel_post' in update) {
    return true;
  }

  if ('edited_channel_post' in update) {
    return true;
  }

  if (update.message?.sender_chat?.type === 'channel') {
    return true;
  }

  if (update.edited_message?.sender_chat?.type === 'channel') {
    return true;
  }

  if (isChannelChat(ctx.chat)) {
    return true;
  }

  if (ctx.channelPost && isChannelChat(ctx.channelPost.chat)) {
    return true;
  }

  if (hasChannelSender(ctx.senderChat)) {
    return true;
  }

  if (
    isChannelChat(update.channel_post?.chat) ||
    isChannelChat(update.edited_channel_post?.chat)
  ) {
    return true;
  }

  if (
    hasChannelSender(update.message?.sender_chat) ||
    hasChannelSender(update.edited_message?.sender_chat)
  ) {
    return true;
  }

  if (isChannelChat(update.message?.chat) || isChannelChat(update.edited_message?.chat)) {
    return true;
  }

  return false;
};

export const auth = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  if (!ctx.from) {
    if (isChannelUpdate(ctx)) {
      await next();
      return;
    }

    logger.warn({ update: ctx.update }, 'Received update without sender information');
    return;
  }

  try {
    const authState = await loadAuthState(ctx.from);
    applyAuthState(ctx, authState);
  } catch (error) {
    logger.error({ err: error, update: ctx.update }, 'Failed to authenticate update');
    return;
  }

  await next();
};

export const __testing__ = {
  loadAuthState,
  mapAuthRow,
  buildExecutorState,
  normaliseRole,
};
