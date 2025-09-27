import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { hasUsersCitySelectedColumn, pool } from '../../db';
import { isAppCity } from '../../domain/cities';
import { copy } from '../copy';
import {
  EXECUTOR_ROLES,
  type AuthExecutorState,
  type AuthState,
  type AuthStateSnapshot,
  type BotContext,
  type ExecutorRole,
  type UserRole,
  type UserMenuRole,
  type UserStatus,
} from '../types';

type Nullable<T> = T | null | undefined;

class AuthStateQueryError extends Error {
  declare cause: unknown;

  constructor(message: string, options: { cause: unknown }) {
    super(message);
    this.name = 'AuthStateQueryError';
    this.cause = options.cause;
  }
}

interface AuthQueryRow {
  tg_id: string | number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  phone_verified: boolean | null;
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
    case 'guest':
      return 'guest';
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

const deriveSnapshotStatus = (role: UserRole): UserStatus => {
  switch (role) {
    case 'courier':
    case 'driver':
      return 'active_executor';
    case 'moderator':
      return 'active_executor';
    case 'client':
      return 'active_client';
    case 'guest':
    default:
      return 'guest';
  }
};

const cloneExecutorState = (executor: AuthExecutorState): AuthExecutorState => ({
  verifiedRoles: { ...executor.verifiedRoles },
  hasActiveSubscription: executor.hasActiveSubscription,
  isVerified: executor.isVerified,
});

interface SnapshotHydrationOptions {
  restoreRole?: boolean;
}

const buildAuthStateFromSnapshot = (
  ctx: BotContext,
  snapshot: AuthStateSnapshot,
  options: SnapshotHydrationOptions = {},
): AuthState => {
  const base = createGuestAuthState(ctx.from!);
  const sessionUser = ctx.session.user;

  if (sessionUser) {
    base.user.username = sessionUser.username ?? base.user.username;
    base.user.firstName = sessionUser.firstName ?? base.user.firstName;
    base.user.lastName = sessionUser.lastName ?? base.user.lastName;
    base.user.phoneVerified = sessionUser.phoneVerified ?? base.user.phoneVerified;
  }

  if (ctx.session.phoneNumber) {
    base.user.phone = ctx.session.phoneNumber;
  }

  const shouldRestoreRole = options.restoreRole ?? true;
  if (shouldRestoreRole) {
    base.user.role = snapshot.role;
    base.user.status = snapshot.status ?? deriveSnapshotStatus(snapshot.role);
  }
  base.user.phoneVerified = Boolean(snapshot.phoneVerified || base.user.phoneVerified);
  const userVerifiedFromSnapshot = snapshot.userIsVerified || snapshot.executor.isVerified;
  base.user.isVerified = Boolean(userVerifiedFromSnapshot || base.user.isVerified);
  base.user.citySelected = snapshot.city ?? base.user.citySelected;
  base.executor = cloneExecutorState(snapshot.executor);
  base.isModerator = shouldRestoreRole && snapshot.role === 'moderator';

  return base;
};

const deriveUserStatus = (row: AuthQueryRow, status: UserStatus): UserStatus => {
  if (status === 'trial_expired' || status === 'suspended' || status === 'banned') {
    return status;
  }

  if (row.is_blocked) {
    return 'suspended';
  }

  const role = normaliseRole(row.role);
  const hasVerifiedPhone = Boolean(row.phone_verified);

  if (!hasVerifiedPhone) {
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
          is_blocked = false,
          updated_at = now()
        RETURNING
          tg_id,
          username,
          first_name,
          last_name,
          phone,
          phone_verified,
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
        u.phone_verified,
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
      phoneVerified: Boolean(row.phone_verified),
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
  let includeCitySelected: boolean;
  try {
    includeCitySelected = await hasUsersCitySelectedColumn();
  } catch (error) {
    throw new AuthStateQueryError('Failed to resolve auth query metadata', { cause: error });
  }

  const authQuery = buildAuthQuery(includeCitySelected);

  let rows: AuthQueryRow[];
  try {
    ({ rows } = await pool.query<AuthQueryRow>(authQuery, [
      from.id,
      from.username ?? null,
      from.first_name ?? null,
      from.last_name ?? null,
    ]));
  } catch (error) {
    throw new AuthStateQueryError('Failed to query authentication state', { cause: error });
  }

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to load authentication context');
  }

  return mapAuthRow(row);
};

const createGuestAuthState = (from: NonNullable<BotContext['from']>): AuthState => ({
  user: {
    telegramId: from.id,
    username: from.username ?? undefined,
    firstName: from.first_name ?? undefined,
    lastName: from.last_name ?? undefined,
    phoneVerified: false,
    role: 'guest',
    status: 'guest',
    isVerified: false,
    isBlocked: false,
  },
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  isModerator: false,
});

const applyAuthState = (
  ctx: BotContext,
  authState: AuthState,
  options?: { isAuthenticated?: boolean; isStale?: boolean },
): void => {
  ctx.auth = authState;
  ctx.session.isAuthenticated = options?.isAuthenticated ?? true;
  ctx.session.user = {
    id: authState.user.telegramId,
    username: authState.user.username,
    firstName: authState.user.firstName,
    lastName: authState.user.lastName,
    phoneVerified: authState.user.phoneVerified,
  };
  if (authState.user.phone && !ctx.session.phoneNumber) {
    ctx.session.phoneNumber = authState.user.phone;
  }
  if (authState.user.citySelected && !ctx.session.city) {
    ctx.session.city = authState.user.citySelected;
  }

  ctx.session.authSnapshot = {
    role: authState.user.role,
    status: authState.user.status,
    phoneVerified: authState.user.phoneVerified,
    userIsVerified: authState.user.isVerified,
    executor: cloneExecutorState(authState.executor),
    city: authState.user.citySelected,
    stale: options?.isStale ?? false,
  } satisfies AuthStateSnapshot;
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
    applyAuthState(ctx, authState, { isStale: false });
  } catch (error) {
    if (error instanceof AuthStateQueryError) {
      const cachedSnapshot = ctx.session.authSnapshot;
      const snapshot: AuthStateSnapshot = {
        role: cachedSnapshot.role,
        status: cachedSnapshot.status ?? deriveSnapshotStatus(cachedSnapshot.role),
        phoneVerified: cachedSnapshot.phoneVerified,
        userIsVerified: cachedSnapshot.userIsVerified,
        executor: cloneExecutorState(cachedSnapshot.executor),
        city: cachedSnapshot.city,
        stale: true,
      } satisfies AuthStateSnapshot;

      const authState = buildAuthStateFromSnapshot(ctx, snapshot);
      applyAuthState(ctx, authState, { isAuthenticated: false, isStale: true });
      ctx.session.isAuthenticated = false;
      ctx.session.authSnapshot.stale = true;
      logger.warn(
        { err: error.cause ?? error, update: ctx.update },
        'Failed to load auth state, using cached snapshot',
      );
      await next();
      return;
    }

    logger.error({ err: error, update: ctx.update }, 'Failed to authenticate update');
    if (typeof ctx.answerCbQuery === 'function') {
      try {
        await ctx.answerCbQuery(copy.serviceUnavailable, { show_alert: false });
      } catch (answerError) {
        logger.debug({ err: answerError }, 'Failed to answer callback query after auth failure');
      }
    }

    if (ctx.chat?.type === 'private') {
      try {
        await ctx.reply(copy.serviceUnavailable);
      } catch (replyError) {
        logger.debug({ err: replyError }, 'Failed to notify user about auth failure');
      }
    }
    return;
  }

  await next();
};

export const loadAuthStateByTelegramId = async (telegramId: number): Promise<AuthState> => {
  const from = { id: telegramId } as NonNullable<BotContext['from']>;
  return loadAuthState(from);
};

export const __testing__ = {
  loadAuthState,
  mapAuthRow,
  buildExecutorState,
  normaliseRole,
};
