import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
  findActiveSubscriptionForUser,
  findSubscriptionsExpiringSoon,
  findSubscriptionsToExpire,
  hasActiveSubscription,
} from '../src/db/subscriptions';
import { pool } from '../src/db';

type QueryFn = (...args: Parameters<typeof pool.query>) => ReturnType<typeof pool.query>;

const originalQuery: QueryFn = pool.query.bind(pool);

const setPoolQuery = (fn: QueryFn): void => {
  (pool as unknown as { query: QueryFn }).query = fn;
};

interface RecordedQuery {
  text: string;
  params: ReadonlyArray<unknown> | undefined;
}

describe('subscription queries status casting', () => {
  afterEach(() => {
    setPoolQuery(originalQuery);
  });

  it('casts status filter when loading expiring subscriptions', async () => {
    const queries: RecordedQuery[] = [];
    const now = new Date('2025-01-01T00:00:00Z');
    const warnUntil = new Date('2025-01-02T00:00:00Z');
    const row = {
      id: '101',
      short_id: 'sub-101',
      user_id: '777',
      chat_id: '-100222333',
      status: 'active',
      days: 30,
      next_billing_at: warnUntil.toISOString(),
      grace_until: warnUntil.toISOString(),
      expires_at: warnUntil.toISOString(),
      last_warning_at: null,
      tg_id: '777',
      username: 'expiring_user',
      first_name: 'Expiring',
      last_name: 'User',
    };

    setPoolQuery(async (...args) => {
      const [first, second] = args;
      if (typeof first === 'string') {
        queries.push({ text: first, params: second as ReadonlyArray<unknown> | undefined });
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string; values?: ReadonlyArray<unknown> };
        queries.push({ text: config.text ?? '', params: config.values });
      }
      return { rows: [row] } as any;
    });

    const subscriptions = await findSubscriptionsExpiringSoon(now, warnUntil, 12);

    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].id, 101);
    assert.match(queries[0]?.text ?? '', /\$3::subscription_status\[\]/u);
    assert.deepEqual(queries[0]?.params, [now, warnUntil, ['active'], 12]);
  });

  it('casts status filter when loading subscriptions to expire', async () => {
    const queries: RecordedQuery[] = [];
    const now = new Date('2025-01-05T00:00:00Z');
    const row = {
      id: '202',
      short_id: 'sub-202',
      user_id: '888',
      chat_id: '-100333444',
      status: 'active',
      days: 14,
      next_billing_at: now.toISOString(),
      grace_until: null,
      expires_at: now.toISOString(),
      last_warning_at: null,
      tg_id: '888',
      username: 'expiring_next',
      first_name: 'Next',
      last_name: 'User',
    };

    setPoolQuery(async (...args) => {
      const [first, second] = args;
      if (typeof first === 'string') {
        queries.push({ text: first, params: second as ReadonlyArray<unknown> | undefined });
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string; values?: ReadonlyArray<unknown> };
        queries.push({ text: config.text ?? '', params: config.values });
      }
      return { rows: [row] } as any;
    });

    const subscriptions = await findSubscriptionsToExpire(now);

    assert.equal(subscriptions.length, 1);
    assert.equal(subscriptions[0].id, 202);
    assert.match(queries[0]?.text ?? '', /\$2::subscription_status\[\]/u);
    assert.deepEqual(queries[0]?.params, [now, ['active']]);
  });

  it('casts status filter when checking active subscriptions', async () => {
    const queries: RecordedQuery[] = [];
    setPoolQuery(async (...args) => {
      const [first, second] = args;
      if (typeof first === 'string') {
        queries.push({ text: first, params: second as ReadonlyArray<unknown> | undefined });
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string; values?: ReadonlyArray<unknown> };
        queries.push({ text: config.text ?? '', params: config.values });
      }
      return { rows: [{ exists: 1 }] } as any;
    });

    const result = await hasActiveSubscription(-100555666, 987654321);

    assert.equal(result, true);
    assert.match(queries[0]?.text ?? '', /\$3::subscription_status\[\]/u);
    assert.deepEqual(queries[0]?.params, [-100555666, 987654321, ['active']]);
    assert.match(
      queries[0]?.text ?? '',
      /COALESCE\(s\.grace_until, s\.next_billing_at\) > now\(\)/u,
    );
    assert.ok(
      !/COALESCE\(s\.grace_until, s\.next_billing_at\) IS NULL/u.test(queries[0]?.text ?? ''),
    );
  });

  it('filters active subscription candidates by expiration date when returning details', async () => {
    const queries: RecordedQuery[] = [];
    setPoolQuery(async (...args) => {
      const [first, second] = args;
      if (typeof first === 'string') {
        queries.push({ text: first, params: second as ReadonlyArray<unknown> | undefined });
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string; values?: ReadonlyArray<unknown> };
        queries.push({ text: config.text ?? '', params: config.values });
      }
      return { rows: [] } as any;
    });

    const result = await findActiveSubscriptionForUser(-100123456, 555777);

    assert.equal(result, null);
    assert.match(
      queries[0]?.text ?? '',
      /COALESCE\(grace_until, next_billing_at\) > now\(\)/u,
    );
    assert.ok(
      !/COALESCE\(grace_until, next_billing_at\) IS NULL/u.test(queries[0]?.text ?? ''),
    );
  });

  it('derives expiration from next billing date when grace period is missing', async () => {
    const queries: RecordedQuery[] = [];
    const nextBillingAt = new Date('2025-02-01T12:00:00Z');

    setPoolQuery(async (...args) => {
      const [first, second] = args;
      if (typeof first === 'string') {
        queries.push({ text: first, params: second as ReadonlyArray<unknown> | undefined });
      } else if (first && typeof first === 'object') {
        const config = first as { text?: string; values?: ReadonlyArray<unknown> };
        queries.push({ text: config.text ?? '', params: config.values });
      }

      if (queries.length === 1) {
        return {
          rows: [
            {
              id: '303',
              chat_id: '-100777888',
              next_billing_at: nextBillingAt.toISOString(),
              grace_until: null,
            },
          ],
        } as any;
      }

      return { rows: [] } as any;
    });

    const result = await findActiveSubscriptionForUser(-100777888, 9001);

    assert.ok(result);
    assert.equal(result?.nextBillingAt?.toISOString(), nextBillingAt.toISOString());
    assert.equal(result?.expiresAt?.toISOString(), nextBillingAt.toISOString());
    assert.match(queries[0]?.text ?? '', /SELECT id, chat_id, next_billing_at, grace_until/u);
  });
});
