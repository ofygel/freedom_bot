import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import * as bootstrap from '../src/db/bootstrap';
import * as verifyQueue from '../src/bot/moderation/verifyQueue';
import * as paymentQueue from '../src/bot/moderation/paymentQueue';
import * as supportService from '../src/bot/services/support';
import {
  initialiseAppState,
  isDatabaseFallbackActive,
  resetStartupRetryStateForTests,
} from '../src/app';

const createConnectionError = (): NodeJS.ErrnoException => {
  const error = new Error('connect ECONNREFUSED 127.0.0.1:5432') as NodeJS.ErrnoException;
  error.code = 'ECONNREFUSED';
  return error;
};

describe('initialiseAppState', () => {
  let ensureDatabaseSchemaMock: ReturnType<typeof mock.method> | undefined;
  let restoreVerificationMock: ReturnType<typeof mock.method> | undefined;
  let restorePaymentMock: ReturnType<typeof mock.method> | undefined;
  let restoreSupportMock: ReturnType<typeof mock.method> | undefined;
  let setIntervalMock: ReturnType<typeof mock.method> | undefined;
  let clearIntervalMock: ReturnType<typeof mock.method> | undefined;

  beforeEach(() => {
    setIntervalMock = mock.method(
      global,
      'setInterval',
      ((handler: (...args: unknown[]) => void, timeout?: number, ...args: unknown[]) => {
        // Record the handler to avoid optimisations dropping the reference.
        void handler;
        void args;
        return Symbol('interval') as unknown as NodeJS.Timeout;
      }) as unknown as typeof global.setInterval,
    );

    clearIntervalMock = mock.method(
      global,
      'clearInterval',
      (() => undefined) as typeof global.clearInterval,
    );
  });

  afterEach(() => {
    ensureDatabaseSchemaMock?.mock.restore();
    restoreVerificationMock?.mock.restore();
    restorePaymentMock?.mock.restore();
    restoreSupportMock?.mock.restore();
    setIntervalMock?.mock.restore();
    clearIntervalMock?.mock.restore();
    resetStartupRetryStateForTests();
    ensureDatabaseSchemaMock = undefined;
    restoreVerificationMock = undefined;
    restorePaymentMock = undefined;
    restoreSupportMock = undefined;
    setIntervalMock = undefined;
    clearIntervalMock = undefined;
  });

  it('schedules retries when startup dependencies fail with connection errors', async () => {
    const connectionError = createConnectionError();

    ensureDatabaseSchemaMock = mock.method(bootstrap, 'ensureDatabaseSchema', async () => {
      throw connectionError;
    });

    restoreVerificationMock = mock.method(
      verifyQueue,
      'restoreVerificationModerationQueue',
      async () => {
        throw connectionError;
      },
    );

    restorePaymentMock = mock.method(
      paymentQueue,
      'restorePaymentModerationQueue',
      async () => {
        throw connectionError;
      },
    );

    restoreSupportMock = mock.method(
      supportService,
      'restoreSupportThreads',
      async () => {
        throw connectionError;
      },
    );

    await initialiseAppState();

    assert.equal(isDatabaseFallbackActive(), true, 'fallback mode should be enabled');

    assert.equal(ensureDatabaseSchemaMock.mock.callCount(), 1);
    assert.equal(restoreVerificationMock.mock.callCount(), 1);
    assert.equal(restorePaymentMock.mock.callCount(), 1);
    assert.equal(restoreSupportMock.mock.callCount(), 1);

    const calls = setIntervalMock?.mock.calls ?? [];
    assert.equal(calls.length, 4, 'every failing dependency should schedule a retry interval');
    for (const call of calls) {
      const [, delay] = call.arguments;
      assert.equal(typeof delay, 'number');
      assert.ok((delay as number) > 0);
    }

    assert.equal(clearIntervalMock?.mock.callCount() ?? 0, 0);
  });

  it('retries startup tasks until they succeed and clears the retry interval', async () => {
    const connectionError = createConnectionError();
    let supportRestoreAttempts = 0;
    let resumeRetry!: () => void;
    const retryCompleted = new Promise<void>((resolve) => {
      resumeRetry = resolve;
    });

    ensureDatabaseSchemaMock = mock.method(bootstrap, 'ensureDatabaseSchema', async () => undefined);

    restoreVerificationMock = mock.method(
      verifyQueue,
      'restoreVerificationModerationQueue',
      async () => undefined,
    );

    restorePaymentMock = mock.method(
      paymentQueue,
      'restorePaymentModerationQueue',
      async () => undefined,
    );

    restoreSupportMock = mock.method(
      supportService,
      'restoreSupportThreads',
      async () => {
        supportRestoreAttempts += 1;
        if (supportRestoreAttempts === 1) {
          throw connectionError;
        }

        resumeRetry();
      },
    );

    await initialiseAppState();

    assert.equal(restoreSupportMock.mock.callCount(), 1);

    const calls = setIntervalMock?.mock.calls ?? [];
    assert.equal(calls.length, 1, 'support restore failure should schedule a retry interval');

    const [retryHandler] = calls[0]?.arguments ?? [];
    assert.equal(typeof retryHandler, 'function');

    (retryHandler as () => void)();
    await retryCompleted;
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(restoreSupportMock.mock.callCount(), 2, 'support restore should succeed on retry');
    assert.equal(clearIntervalMock?.mock.callCount(), 1, 'retry interval should be cleared after success');
  });
});
