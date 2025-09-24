import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';

import {
  createTrialSubscription,
  TrialSubscriptionUnavailableError,
} from '../src/db/subscriptions';
import * as dbClient from '../src/db/client';
import { resolveInviteLink } from '../src/bot/flows/executor/orders';
import * as bindings from '../src/bot/channels/bindings';
import * as subscriptionsDb from '../src/db/subscriptions';
import type { BotContext, ExecutorFlowState } from '../src/bot/types';

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
});
