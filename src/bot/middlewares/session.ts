import type { MiddlewareFn } from 'telegraf';

import { logger } from '../../config';
import { pool, type PoolClient } from '../../db';
import {
  deleteSessionState,
  loadSessionState,
  saveSessionState,
  type SessionKey,
} from '../../db/sessions';
import {
  deleteSessionCache,
  loadSessionCache,
  saveSessionCache,
} from '../../infra/sessionCache';
import { isAppCity } from '../../domain/cities';
import {
  EXECUTOR_ROLES,
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type AuthStateSnapshot,
  type BotContext,
  type ClientFlowState,
  type ClientOrderDraftState,
  type ExecutorFlowState,
  type ExecutorSubscriptionState,
  type ExecutorUploadedPhoto,
  type ExecutorVerificationState,
  type SessionState,
  type SessionUser,
  type SupportSessionState,
  type UiSessionState,
  type UserRole,
  type UserStatus,
  type ExecutorRole,
} from '../types';

const createVerificationState = (): ExecutorVerificationState => {
  const verification = {} as ExecutorVerificationState;
  for (const role of EXECUTOR_ROLES) {
    verification[role] = {
      status: 'idle',
      requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
      uploadedPhotos: [],
    };
  }
  return verification;
};

const createSubscriptionState = (): ExecutorSubscriptionState => ({
  status: 'idle',
});

const createExecutorState = (): ExecutorFlowState => ({
  role: undefined,
  verification: createVerificationState(),
  subscription: createSubscriptionState(),
});

const createClientOrderDraft = (): ClientOrderDraftState => ({
  stage: 'idle',
});

const createClientState = (): ClientFlowState => ({
  taxi: createClientOrderDraft(),
  delivery: createClientOrderDraft(),
});

const createUiState = (): UiSessionState => ({
  steps: {},
  homeActions: [],
  pendingCityAction: undefined,
  clientMenuVariant: undefined,
});

const createSupportState = (): SupportSessionState => ({
  status: 'idle',
});

const USER_ROLES: readonly UserRole[] = ['guest', 'client', 'courier', 'driver', 'moderator'];
const USER_STATUSES: readonly UserStatus[] = [
  'guest',
  'onboarding',
  'awaiting_phone',
  'active_client',
  'active_executor',
  'trial_expired',
  'suspended',
  'banned',
];

const createAuthSnapshot = (): AuthStateSnapshot => ({
  role: 'guest',
  status: 'guest',
  phoneVerified: false,
  userIsVerified: false,
  executor: {
    verifiedRoles: { courier: false, driver: false },
    hasActiveSubscription: false,
    isVerified: false,
  },
  city: undefined,
  stale: false,
});

const rebuildAuthSnapshot = (value: unknown, sessionUser?: SessionUser): AuthStateSnapshot => {
  const snapshot = createAuthSnapshot();
  if (!value || typeof value !== 'object') {
    if (sessionUser?.phoneVerified !== undefined) {
      snapshot.phoneVerified = Boolean(sessionUser.phoneVerified);
    }
    return snapshot;
  }

  const candidate = value as Partial<AuthStateSnapshot> & {
    executor?: Partial<AuthStateSnapshot['executor']> & {
      verifiedRoles?: Partial<Record<ExecutorRole, unknown>>;
    };
  };

  if (typeof candidate.role === 'string' && USER_ROLES.includes(candidate.role as UserRole)) {
    snapshot.role = candidate.role as UserRole;
  }

  if (typeof candidate.status === 'string' && USER_STATUSES.includes(candidate.status as UserStatus)) {
    snapshot.status = candidate.status as UserStatus;
  }

  if (candidate.executor && typeof candidate.executor === 'object') {
    const executor = candidate.executor;
    const verifiedRoles = executor.verifiedRoles ?? {};
    snapshot.executor = {
      verifiedRoles: {
        courier: Boolean((verifiedRoles as Record<ExecutorRole, unknown>).courier),
        driver: Boolean((verifiedRoles as Record<ExecutorRole, unknown>).driver),
      },
      hasActiveSubscription: Boolean(executor.hasActiveSubscription),
      isVerified: Boolean(executor.isVerified),
    };
  }

  const hasPhoneVerifiedField = Object.prototype.hasOwnProperty.call(candidate, 'phoneVerified');
  if (hasPhoneVerifiedField) {
    snapshot.phoneVerified = Boolean(
      (candidate as { phoneVerified?: unknown }).phoneVerified,
    );
  } else if (sessionUser?.phoneVerified !== undefined) {
    snapshot.phoneVerified = Boolean(sessionUser.phoneVerified);
  }

  const hasUserVerifiedField = Object.prototype.hasOwnProperty.call(candidate, 'userIsVerified');
  if (hasUserVerifiedField && typeof candidate.userIsVerified === 'boolean') {
    snapshot.userIsVerified = candidate.userIsVerified;
  } else if (candidate.executor && typeof candidate.executor === 'object') {
    const executorIsVerified = Boolean(
      (candidate.executor as { isVerified?: unknown }).isVerified,
    );
    if (executorIsVerified) {
      snapshot.userIsVerified = true;
    }
  }

  if (candidate.city && isAppCity(candidate.city)) {
    snapshot.city = candidate.city;
  }

  if (typeof candidate.stale === 'boolean') {
    snapshot.stale = candidate.stale;
  }

  return snapshot;
};

const isExecutorRole = (value: unknown): value is ExecutorFlowState['role'] =>
  typeof value === 'string' && EXECUTOR_ROLES.includes(value as (typeof EXECUTOR_ROLES)[number]);

const rebuildExecutorState = (value: unknown): ExecutorFlowState => {
  const state = createExecutorState();
  if (!value || typeof value !== 'object') {
    return state;
  }

  const executor = value as Partial<ExecutorFlowState>;

  if (isExecutorRole(executor.role)) {
    state.role = executor.role;
  } else {
    state.role = undefined;
  }

  if (executor.subscription && typeof executor.subscription === 'object') {
    Object.assign(state.subscription, executor.subscription);
  }

  if (executor.verification && typeof executor.verification === 'object') {
    const verification = executor.verification as Partial<ExecutorVerificationState>;
    for (const role of EXECUTOR_ROLES) {
      const candidate = verification[role];
      if (!candidate || typeof candidate !== 'object') {
        continue;
      }

      Object.assign(state.verification[role], candidate);

      const uploadedPhotos = (candidate as { uploadedPhotos?: unknown }).uploadedPhotos;
      if (Array.isArray(uploadedPhotos)) {
        const photos: ExecutorUploadedPhoto[] = [];
        for (const item of uploadedPhotos) {
          if (!item || typeof item !== 'object') {
            continue;
          }

          const fileId = (item as { fileId?: unknown }).fileId;
          const messageId = (item as { messageId?: unknown }).messageId;
          if (typeof fileId !== 'string' || typeof messageId !== 'number') {
            continue;
          }

          const photo: ExecutorUploadedPhoto = {
            fileId,
            messageId,
          };

          const fileUniqueId = (item as { fileUniqueId?: unknown }).fileUniqueId;
          if (typeof fileUniqueId === 'string') {
            photo.fileUniqueId = fileUniqueId;
          }

          photos.push(photo);
        }

        state.verification[role].uploadedPhotos = photos;
      }
    }
  }

  return state;
};

const rebuildClientState = (value: unknown): ClientFlowState => {
  const state = createClientState();
  if (!value || typeof value !== 'object') {
    return state;
  }

  const client = value as Partial<ClientFlowState>;
  for (const key of ['taxi', 'delivery'] as const) {
    const draft = client[key];
    if (draft && typeof draft === 'object') {
      Object.assign(state[key], draft);
    }
  }

  return state;
};

const createDefaultState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  city: undefined,
  authSnapshot: createAuthSnapshot(),
  executor: createExecutorState(),
  client: createClientState(),
  ui: createUiState(),
  support: createSupportState(),
});

const prepareFallbackSession = (
  state: SessionState | null | undefined,
): SessionState => {
  const session = state ?? createDefaultState();
  session.isAuthenticated = false;
  return session;
};

const SESSION_META = Symbol('session-meta');

interface SessionMeta {
  key: SessionKey;
  cleared: boolean;
}

type SessionMetaContainer = {
  [SESSION_META]?: SessionMeta;
};

const setSessionMeta = (ctx: BotContext, meta?: SessionMeta): void => {
  const container = ctx as BotContext & SessionMetaContainer;
  if (meta) {
    container[SESSION_META] = meta;
  } else {
    delete container[SESSION_META];
  }
};

const getSessionMeta = (ctx: BotContext): SessionMeta | undefined => {
  const container = ctx as BotContext & SessionMetaContainer;
  return container[SESSION_META];
};

const parseScopeId = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }

    if (/^[+-]?\d+$/.test(trimmed)) {
      try {
        return BigInt(trimmed).toString();
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
};

export const resolveSessionKey = (ctx: BotContext): SessionKey | undefined => {
  const chatId = parseScopeId(ctx.chat?.id);
  if (chatId !== undefined) {
    return { scope: 'chat', scopeId: chatId } satisfies SessionKey;
  }

  const userId = parseScopeId(ctx.from?.id);
  if (userId !== undefined) {
    return { scope: 'user', scopeId: userId } satisfies SessionKey;
  }

  return undefined;
};

export const clearSession = async (ctx: BotContext): Promise<void> => {
  const key = resolveSessionKey(ctx);
  if (!key) {
    return;
  }

  const meta = getSessionMeta(ctx);
  if (meta && meta.key.scope === key.scope && meta.key.scopeId === key.scopeId) {
    meta.cleared = true;
    return;
  }

  await deleteSessionState(pool, key);
  await deleteSessionCache(key);
};

export const session = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  const key = resolveSessionKey(ctx);
  if (!key) {
    await next();
    return;
  }

  let client: PoolClient | undefined;
  const meta: SessionMeta = { key, cleared: false };
  setSessionMeta(ctx, meta);

  let nextError: unknown;
  let fallbackMode = false;
  let nextInvoked = false;
  let cachedState: SessionState | null = null;
  let finalState: SessionState | undefined;

  const invokeNext = async (): Promise<void> => {
    if (nextInvoked) {
      return;
    }

    nextInvoked = true;
    try {
      await next();
    } catch (error) {
      nextError = error;
    }
  };

  try {
    try {
      cachedState = await loadSessionCache(key);
    } catch (error) {
      logger.warn({ err: error, key }, 'Failed to load session cache, continuing');
    }

    try {
      client = await pool.connect();
    } catch (error) {
      const fallbackSession = prepareFallbackSession(cachedState);
      ctx.session = fallbackSession;
      logger.warn({ err: error, key }, 'Failed to connect to database for session state');

      fallbackMode = true;
      await invokeNext();
      finalState = ctx.session;
    }

    const dbClient = client;
    if (!fallbackMode && !dbClient) {
      const fallbackSession = prepareFallbackSession(cachedState);
      ctx.session = fallbackSession;
      logger.warn({ key }, 'Database client was not initialised for session state');

      fallbackMode = true;
      await invokeNext();
      finalState = ctx.session;
    }

    let state: SessionState | undefined;

    if (!fallbackMode && dbClient) {
      const activeClient = dbClient;
      try {
        const existing = await loadSessionState(activeClient, key);
        state = existing ?? cachedState ?? createDefaultState();
      } catch (error) {
        const fallbackSession = prepareFallbackSession(cachedState);
        ctx.session = fallbackSession;
        logger.warn({ err: error, key }, 'Failed to load session state, using default state');

        fallbackMode = true;
        await invokeNext();
        finalState = ctx.session;
      }
    }

    if (!fallbackMode && dbClient) {
      const activeClient = dbClient;
      if (!state) {
        state = cachedState ?? createDefaultState();
      }

      if (!('city' in state)) {
        state.city = undefined;
      }

      if (!state.ui) {
        state.ui = createUiState();
      }

      if (!state.support) {
        state.support = createSupportState();
      }

      state.authSnapshot = rebuildAuthSnapshot(
        (state as { authSnapshot?: unknown }).authSnapshot,
        (state as { user?: SessionUser }).user,
      );

      state.executor = rebuildExecutorState((state as { executor?: unknown }).executor);
      state.client = rebuildClientState((state as { client?: unknown }).client);

      ctx.session = state;

      await invokeNext();
      finalState = ctx.session;

      if (meta.cleared) {
        try {
          await deleteSessionState(activeClient, key);
        } catch (error) {
          logger.warn({ err: error, key }, 'Failed to delete session state, continuing without persistence');
        }
      } else {
        try {
          await saveSessionState(activeClient, key, ctx.session);
        } catch (error) {
          logger.warn({ err: error, key }, 'Failed to save session state, continuing without persistence');
        }
      }
    }

    if (fallbackMode) {
      if (ctx.session) {
        ctx.session = prepareFallbackSession(ctx.session);
      }
      await invokeNext();
      finalState = ctx.session;
    }
  } finally {
    setSessionMeta(ctx, undefined);
    client?.release();
  }

  if (nextError) {
    throw nextError;
  }

  if (meta.cleared) {
    try {
      await deleteSessionCache(key);
    } catch (error) {
      logger.warn({ err: error, key }, 'Failed to clear session cache after reset');
    }
    return;
  }

  if (!finalState) {
    return;
  }

  try {
    const stateToCache = fallbackMode ? prepareFallbackSession(finalState) : finalState;
    await saveSessionCache(key, stateToCache);
  } catch (error) {
    logger.warn({ err: error, key }, 'Failed to persist session cache');
  }
};

export type { SessionState };
