import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  createTrialSubscription,
  TrialSubscriptionUnavailableError,
} from '../src/db/subscriptions';
import * as dbClient from '../src/db/client';
import { processOrdersRequest, resolveInviteLink } from '../src/bot/flows/executor/orders';
import * as bindings from '../src/bot/channels/bindings';
import * as subscriptionsDb from '../src/db/subscriptions';
import type { BotContext, ExecutorFlowState } from '../src/bot/types';
import { copy } from '../src/bot/copy';
import { ui, type UiStepOptions } from '../src/bot/ui';

type RecordedQuery = { text: string; params?: unknown[] };

describe('createTrialSubscription', () => {
  let withTxMock: ReturnType<typeof mock.method>;
  let client: { query: ReturnType<typeof mock.fn> };
  let recordedQueries: RecordedQuery[];

  beforeEach(() => {
    recordedQueries = [];
    client = {
      query: mock.fn(async () => ({ rows: [] })),
    };

    withTxMock = mock.method(dbClient, 'withTx', async (callback: any) =>
      callback(client as unknown as dbClient.PoolClient),
    );
  });

  afterEach(() => {
    withTxMock.mock.restore();
  });

  it('creates a new trial subscription and records metadata', async () => {
    client.query.mock.mockImplementation(
      async (
        text: string | { text?: string; values?: unknown[] },
        params?: unknown[],
      ) => {
        const sql = typeof text === 'string' ? text : text?.text ?? '';
        const values = typeof text === 'object' && text ? text.values : params;
        recordedQueries.push({ text: sql, params: values ? [...(values as unknown[])] : undefined });

        if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }

        if (sql.includes('INSERT INTO subscriptions')) {
          return { rows: [{ id: '101' }] };
        }

        return { rows: [] };
      },
    );

    const now = new Date('2025-03-01T00:00:00Z');
    const result = await createTrialSubscription({
      telegramId: 987,
      username: 'trialuser',
      firstName: 'Trial',
      lastName: 'User',
      phone: '+77000000000',
      role: 'driver',
      chatId: -100500,
      trialDays: 5,
      currency: 'KZT',
      now,
    });

    assert.equal(result.subscriptionId, 101);
    const expectedExpiry = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
    assert.equal(result.expiresAt.toISOString(), expectedExpiry.toISOString());

    const insertQuery = recordedQueries.find((query) =>
      query.text.includes('INSERT INTO subscriptions'),
    );
    assert.ok(insertQuery);
    assert.deepEqual(insertQuery?.params?.slice(0, 3), [987, -100500, 'KZT']);
    const metadata = insertQuery?.params?.[5];
    assert.equal(typeof metadata, 'string');
    if (typeof metadata === 'string') {
      const parsed = JSON.parse(metadata);
      assert.equal(parsed.trialUsed, true);
      assert.equal(parsed.trialDays, 5);
      assert.equal(typeof parsed.trialActivatedAt, 'string');
      assert.equal(typeof parsed.trialExpiresAt, 'string');
    }
  });

  it('rejects when the trial was already used', async () => {
    client.query.mock.mockImplementation(
      async (
        text: string | { text?: string; values?: unknown[] },
        params?: unknown[],
      ) => {
        const sql = typeof text === 'string' ? text : text?.text ?? '';
        const values = typeof text === 'object' && text ? text.values : params;
        recordedQueries.push({ text: sql, params: values ? [...(values as unknown[])] : undefined });

        if (sql.includes('FROM subscriptions') && sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: '202',
                next_billing_at: null,
                grace_until: null,
                metadata: { trialUsed: true },
              },
            ],
          };
        }

        return { rows: [] };
      },
    );

    await assert.rejects(
      () =>
        createTrialSubscription({
          telegramId: 123,
          role: 'courier',
          chatId: -100,
          trialDays: 7,
          currency: 'KZT',
        }),
      (error: unknown) =>
        error instanceof TrialSubscriptionUnavailableError && error.reason === 'already_used',
    );
  });
});

describe('resolveInviteLink with trial subscriptions', () => {
  let getChannelBindingMock: ReturnType<typeof mock.method> | undefined;
  let findActiveSubscriptionMock: ReturnType<typeof mock.method> | undefined;

  afterEach(() => {
    getChannelBindingMock?.mock.restore();
    getChannelBindingMock = undefined;
    findActiveSubscriptionMock?.mock.restore();
    findActiveSubscriptionMock = undefined;
  });

  it('sets invite expiration using the active subscription end', async () => {
    const createInvite = mock.fn<
      (chatId: number, options: { name: string; member_limit?: number; expire_date?: number }) =>
        Promise<{ invite_link: string }>
    >(async () => ({ invite_link: 'https://t.me/+trial' }));

    const ctx = {
      telegram: { createChatInviteLink: createInvite },
      auth: { user: { telegramId: 555 } },
    } as unknown as BotContext;

    const state: ExecutorFlowState = {
      role: 'driver',
      verification: {
        courier: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
        driver: { status: 'idle', requiredPhotos: 0, uploadedPhotos: [] },
      },
      subscription: { status: 'idle' },
    };

    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100777,
    }));

    const expiresAt = new Date('2099-04-01T00:00:00Z');
    findActiveSubscriptionMock = mock.method(
      subscriptionsDb,
      'findActiveSubscriptionForUser',
      async () => ({
        id: 10,
        chatId: -100777,
        nextBillingAt: expiresAt,
        graceUntil: undefined,
        expiresAt,
      }),
    );

    const resolution = await resolveInviteLink(ctx, state);

    assert.equal(createInvite.mock.callCount(), 1);
    const [call] = createInvite.mock.calls;
    assert.ok(call);
    const [chatId, options] = call.arguments;
    assert.equal(chatId, -100777);
    assert.equal(options.member_limit, 1);
    assert.equal(options.expire_date, Math.floor(expiresAt.getTime() / 1000));
    assert.equal(resolution.link, 'https://t.me/+trial');
    assert.equal(resolution.expiresAt?.toISOString(), expiresAt.toISOString());
  });

  it('shows service unavailable prompt when invite generation fails', async () => {
    const createInvite = mock.fn<
      (chatId: number, options: { name: string; member_limit?: number; expire_date?: number }) =>
        Promise<{ invite_link: string }>
    >(async () => ({ invite_link: 'https://t.me/+unexpected' }));

    const ctx = {
      chat: { id: 999, type: 'private' as const },
      telegram: { createChatInviteLink: createInvite },
      session: {
        ephemeralMessages: [],
        isAuthenticated: true,
        awaitingPhone: false,
        executor: {
          role: 'driver' as const,
          verification: {
            courier: { status: 'idle' as const, requiredPhotos: 0, uploadedPhotos: [] },
            driver: { status: 'idle' as const, requiredPhotos: 0, uploadedPhotos: [] },
          },
          subscription: { status: 'idle' as const },
        },
        client: {
          taxi: { stage: 'idle' as const },
          delivery: { stage: 'idle' as const },
        },
        ui: { steps: {}, homeActions: [] },
        support: { status: 'idle' as const },
      },
      auth: {
        user: {
          telegramId: 777,
          phoneVerified: false,
          role: 'driver' as const,
          status: 'active_executor' as const,
          isVerified: false,
          isBlocked: false,
        },
        executor: {
          verifiedRoles: { courier: false, driver: false },
          hasActiveSubscription: true,
          isVerified: false,
        },
        isModerator: false,
      },
      reply: async (text: string) => ({
        message_id: 1,
        chat: { id: 999, type: 'private' as const },
        date: Math.floor(Date.now() / 1000),
        text,
      }),
      update: {} as never,
      updateType: 'callback_query' as const,
      botInfo: {} as never,
      state: {},
    } as unknown as BotContext;

    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100333,
    }));

    findActiveSubscriptionMock = mock.method(
      subscriptionsDb,
      'findActiveSubscriptionForUser',
      async () => {
        throw new Error('db unavailable');
      },
    );

    let recordedStep: UiStepOptions | undefined;
    const uiStepMock = mock.method(ui, 'step', async (_ctx: BotContext, options: UiStepOptions) => {
      recordedStep = options;
      return { messageId: 1, sent: true };
    });

    try {
      await processOrdersRequest(ctx);

      assert.equal(findActiveSubscriptionMock.mock.callCount(), 1);
      assert.equal(createInvite.mock.callCount(), 0);
      assert.ok(recordedStep);
      assert.equal(
        recordedStep?.text,
        `${copy.serviceUnavailable}\n\nНе удалось получить ссылку на канал заказов. Попробуйте позже или обратитесь в поддержку через меню.`,
      );
    } finally {
      uiStepMock.mock.restore();
    }
  });
});
