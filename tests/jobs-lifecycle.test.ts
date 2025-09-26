import './helpers/setup-env';

import assert from 'node:assert/strict';
import cron, { type ScheduledTask, type TaskFn } from 'node-cron';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../src/bot/types';
import { registerJobs, stopJobs } from '../src/jobs';
import * as scheduler from '../src/jobs/scheduler';
import * as paymentReminder from '../src/jobs/paymentReminder';

const createBot = (): Telegraf<BotContext> =>
  ({ telegram: {} } as unknown as Telegraf<BotContext>);

type Spy<F extends (...args: any[]) => unknown> = ReturnType<typeof mock.fn<F>>;

describe('subscription scheduler lifecycle', () => {
  let scheduleMock: ReturnType<typeof mock.method>;
  let stopSpy: Spy<() => void>;
  let destroySpy: Spy<() => void>;

  beforeEach(() => {
    stopSpy = mock.fn<() => void>(() => undefined);
    destroySpy = mock.fn<() => void>(() => undefined);
    scheduleMock = mock.method(cron, 'schedule', (expression: string, _handler: TaskFn | string) => {
      const scheduledTask: ScheduledTask = {
        id: `${expression}:test-task`,
        stop: stopSpy,
        destroy: destroySpy,
        start: () => undefined,
        getStatus: () => 'running',
        execute: async () => undefined,
        getNextRun: () => null,
        on: () => undefined,
        off: () => undefined,
        once: () => undefined,
      };

      return scheduledTask;
    });
  });

  afterEach(() => {
    scheduler.stopSubscriptionScheduler();
    scheduleMock.mock.restore();
    stopSpy.mock.resetCalls();
    destroySpy.mock.resetCalls();
  });

  it('starts the subscription scheduler once and allows restarting after stop', () => {
    const bot = createBot();

    scheduler.startSubscriptionScheduler(bot);
    scheduler.startSubscriptionScheduler(bot);

    assert.equal(scheduleMock.mock.callCount(), 1);
    const [firstCall] = scheduleMock.mock.calls;
    assert.ok(firstCall);
    assert.equal(firstCall.arguments[0], '*/10 * * * *');

    scheduler.stopSubscriptionScheduler();
    assert.equal(stopSpy.mock.callCount(), 1);
    assert.equal(destroySpy.mock.callCount(), 1);

    scheduler.startSubscriptionScheduler(bot);
    assert.equal(scheduleMock.mock.callCount(), 2);
  });

  it('ignores stop requests when the scheduler is not running', () => {
    scheduler.stopSubscriptionScheduler();

    assert.equal(stopSpy.mock.callCount(), 0);
    assert.equal(destroySpy.mock.callCount(), 0);
  });
});

describe('registerJobs', () => {
  let startSchedulerMock: ReturnType<typeof mock.method>;
  let stopSchedulerMock: ReturnType<typeof mock.method>;
  let startPaymentReminderMock: ReturnType<typeof mock.method>;
  let stopPaymentReminderMock: ReturnType<typeof mock.method>;

  beforeEach(() => {
    startSchedulerMock = mock.method(scheduler, 'startSubscriptionScheduler', mock.fn());
    stopSchedulerMock = mock.method(scheduler, 'stopSubscriptionScheduler', mock.fn());
    startPaymentReminderMock = mock.method(paymentReminder, 'startPaymentReminderJob', mock.fn());
    stopPaymentReminderMock = mock.method(paymentReminder, 'stopPaymentReminderJob', mock.fn());

    stopJobs();
    startSchedulerMock.mock.resetCalls();
    stopSchedulerMock.mock.resetCalls();
    startPaymentReminderMock.mock.resetCalls();
    stopPaymentReminderMock.mock.resetCalls();
  });

  afterEach(() => {
    stopJobs();
    startSchedulerMock.mock.restore();
    stopSchedulerMock.mock.restore();
    startPaymentReminderMock.mock.restore();
    stopPaymentReminderMock.mock.restore();
  });

  it('starts background jobs only once while initialized', () => {
    const bot = createBot();

    registerJobs(bot);
    registerJobs(bot);

    assert.equal(startSchedulerMock.mock.callCount(), 1);
    assert.equal(startPaymentReminderMock.mock.callCount(), 1);
  });

  it('does not attempt to stop jobs when they were never started', () => {
    stopJobs();

    assert.equal(stopSchedulerMock.mock.callCount(), 0);
    assert.equal(stopPaymentReminderMock.mock.callCount(), 0);
  });

  it('stops running jobs and allows them to start again later', () => {
    const bot = createBot();

    registerJobs(bot);
    stopJobs();

    assert.equal(stopSchedulerMock.mock.callCount(), 1);
    assert.equal(stopPaymentReminderMock.mock.callCount(), 1);

    registerJobs(bot);

    assert.equal(startSchedulerMock.mock.callCount(), 2);
    assert.equal(startPaymentReminderMock.mock.callCount(), 2);
  });
});
