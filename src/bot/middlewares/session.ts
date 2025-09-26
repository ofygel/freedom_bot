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
  EXECUTOR_ROLES,
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ClientFlowState,
  type ClientOrderDraftState,
  type ExecutorFlowState,
  type ExecutorSubscriptionState,
  type ExecutorVerificationState,
  type SessionState,
  type SupportSessionState,
  type UiSessionState,
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
  role: 'courier',
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

const createDefaultState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  city: undefined,
  executor: createExecutorState(),
  client: createClientState(),
  ui: createUiState(),
  support: createSupportState(),
});

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

  try {
    try {
      client = await pool.connect();
    } catch (error) {
      ctx.session = createDefaultState();
      logger.warn({ err: error, key }, 'Failed to connect to database for session state');

      try {
        await next();
      } catch (innerError) {
        nextError = innerError;
      }

      return;
    }

    const dbClient = client;
    if (!dbClient) {
      ctx.session = createDefaultState();
      logger.warn({ key }, 'Database client was not initialised for session state');

      try {
        await next();
      } catch (innerError) {
        nextError = innerError;
      }

      return;
    }

    let state: SessionState;

    try {
      const existing = await loadSessionState(dbClient, key);
      state = existing ?? createDefaultState();
    } catch (error) {
      ctx.session = createDefaultState();
      logger.warn({ err: error, key }, 'Failed to load session state, using default state');

      try {
        await next();
      } catch (innerError) {
        nextError = innerError;
      }

      return;
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

    ctx.session = state;

    try {
      await next();
    } catch (error) {
      nextError = error;
    }

    if (meta.cleared) {
      try {
        await deleteSessionState(dbClient, key);
      } catch (error) {
        logger.warn({ err: error, key }, 'Failed to delete session state, continuing without persistence');
      }
    } else {
      try {
        await saveSessionState(dbClient, key, ctx.session);
      } catch (error) {
        logger.warn({ err: error, key }, 'Failed to save session state, continuing without persistence');
      }
    }
  } finally {
    setSessionMeta(ctx, undefined);
    client?.release();
  }

  if (nextError) {
    throw nextError;
  }
};

export type { SessionState };
