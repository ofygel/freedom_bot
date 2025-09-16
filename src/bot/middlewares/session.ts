import type { MiddlewareFn } from 'telegraf';

import {
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ClientFlowState,
  type ClientOrderDraftState,
  type ExecutorFlowState,
  type SessionState,
} from '../types';

const createExecutorState = (): ExecutorFlowState => ({
  verification: {
    status: 'idle',
    requiredPhotos: EXECUTOR_VERIFICATION_PHOTO_COUNT,
    uploadedPhotos: [],
  },
  subscription: {},
});

const createClientOrderDraft = (): ClientOrderDraftState => ({
  stage: 'idle',
});

const createClientState = (): ClientFlowState => ({
  taxi: createClientOrderDraft(),
  delivery: createClientOrderDraft(),
});

const createDefaultState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  executor: createExecutorState(),
  client: createClientState(),
});

const resolveSessionKey = (ctx: BotContext): string | undefined => {
  if (ctx.chat?.id !== undefined) {
    return `chat:${ctx.chat.id}`;
  }

  if (ctx.from?.id !== undefined) {
    return `user:${ctx.from.id}`;
  }

  return undefined;
};

const store = new Map<string, SessionState>();

export const clearSession = (ctx: BotContext): void => {
  const key = resolveSessionKey(ctx);
  if (key) {
    store.delete(key);
  }
};

export const session = (): MiddlewareFn<BotContext> => async (ctx, next) => {
  const key = resolveSessionKey(ctx);
  if (!key) {
    await next();
    return;
  }

  const existing = store.get(key);
  const state = existing ?? createDefaultState();

  ctx.session = state;

  try {
    await next();
  } finally {
    store.set(key, ctx.session);
  }
};

export type { SessionState };
