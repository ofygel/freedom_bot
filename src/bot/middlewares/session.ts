import type { MiddlewareFn } from 'telegraf';

import {
  EXECUTOR_ROLES,
  EXECUTOR_VERIFICATION_PHOTO_COUNT,
  type BotContext,
  type ClientFlowState,
  type ClientOrderDraftState,
  type ExecutorFlowState,
  type ExecutorVerificationState,
  type SessionState,
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

const createExecutorState = (): ExecutorFlowState => ({
  role: 'courier',
  verification: createVerificationState(),
  subscription: {},
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
});

const createDefaultState = (): SessionState => ({
  ephemeralMessages: [],
  isAuthenticated: false,
  awaitingPhone: false,
  executor: createExecutorState(),
  client: createClientState(),
  ui: createUiState(),
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

  if (!state.ui) {
    state.ui = createUiState();
  }

  ctx.session = state;

  try {
    await next();
  } finally {
    store.set(key, ctx.session);
  }
};

export type { SessionState };
