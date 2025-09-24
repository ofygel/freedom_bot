import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  tryDecodeCallbackData,
  verifyCallbackForUser,
  wrapCallbackData,
} from '../src/bot/services/callbackTokens';
import type { BotContext } from '../src/bot/types';

const createContext = (overrides: Partial<BotContext['auth']['user']>): BotContext => {
  const user = {
    telegramId: 123456,
    role: 'courier',
    status: 'active_executor',
    isVerified: true,
    isBlocked: false,
    ...overrides,
  };

  return {
    auth: {
      user: user as BotContext['auth']['user'],
      executor: {
        verifiedRoles: { courier: true, driver: false },
        hasActiveSubscription: true,
        isVerified: true,
      },
      isModerator: false,
    },
    session: {
      ephemeralMessages: [],
      isAuthenticated: true,
      awaitingPhone: false,
      executor: {
        role: 'courier',
        verification: {
          courier: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
          driver: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
        },
        subscription: { status: 'idle' },
      },
      client: {
        taxi: { stage: 'idle' },
        delivery: { stage: 'idle' },
      },
      support: { status: 'idle' },
      ui: { steps: {}, homeActions: [] },
    },
  } as unknown as BotContext;
};

describe('callback tokens helper', () => {
  it('preserves raw payload after decoding', () => {
    const raw = 'order:accept:42';
    const secret = 'test-secret';
    const token = wrapCallbackData(raw, {
      secret,
      userId: 123456,
      keyboardNonce: 'abc-123',
      bindToUser: true,
    });

    const decoded = tryDecodeCallbackData(token);
    assert.equal(decoded.ok, true, 'expected token to decode successfully');
    assert.equal(decoded.ok && decoded.wrapped.raw, raw);
  });

  it('rejects mismatched nonce during verification', () => {
    const raw = 'order:accept:99';
    const secret = 'test-secret';
    const token = wrapCallbackData(raw, {
      secret,
      userId: 123456,
      keyboardNonce: 'nonce-one',
      bindToUser: true,
    });

    const decoded = tryDecodeCallbackData(token);
    assert.equal(decoded.ok, true, 'expected token to decode successfully');

    const ctx = createContext({ keyboardNonce: 'nonce-two' });
    const verified = verifyCallbackForUser(ctx, decoded.ok ? decoded.wrapped : ({} as never), secret);
    assert.equal(verified, false, 'expected verification to fail with mismatched nonce');
  });
});

