import type { MiddlewareFn } from 'telegraf';

import { pool } from '../../db';
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

  const client = await pool.connect();
  const meta: SessionMeta = { key, cleared: false };
  setSessionMeta(ctx, meta);

  let nextError: unknown;

  try {
    await client.query('BEGIN');

    const existing = await loadSessionState(client, key, { forUpdate: true });
    const state = existing ?? createDefaultState();

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
      await deleteSessionState(client, key);
    } else {
      await saveSessionState(client, key, ctx.session);
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // eslint-disable-next-line no-console
      console.error('Failed to rollback session transaction', rollbackError);
    }
    throw error;
  } finally {
    setSessionMeta(ctx, undefined);
    client.release();
  }

  if (nextError) {
    throw nextError;
  }
};

export type { SessionState };
