import type { PoolClient } from './client';
import { pool, withTx } from './client';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'paused';

interface SubscriptionRow {
  id: string;
  user_id: string;
  chat_id: string | number;
  status: SubscriptionStatus;
  next_billing_at: Date | string | null;
  grace_until: Date | string | null;
  expires_at: Date | string | null;
  telegram_id: string | number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface SubscriptionWithUser {
  id: string;
  userId: string;
  chatId: number;
  telegramId?: number;
  status: SubscriptionStatus;
  nextBillingAt?: Date;
  graceUntil?: Date;
  expiresAt: Date;
  username?: string;
  firstName?: string;
  lastName?: string;
}

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  'active',
  'trialing',
  'past_due',
];

const parseNumeric = (
  value: string | number | null | undefined,
): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const parseTimestamp = (value: Date | string | null): Date | undefined => {
  if (!value) {
    return undefined;
  }

  return value instanceof Date ? value : new Date(value);
};

const mapSubscriptionRow = (row: SubscriptionRow): SubscriptionWithUser => {
  const chatId = parseNumeric(row.chat_id);
  if (chatId === undefined) {
    throw new Error(
      `Failed to parse chat id for subscription ${row.id}: ${row.chat_id}`,
    );
  }

  const telegramId = parseNumeric(row.telegram_id ?? undefined);
  const nextBillingAt = parseTimestamp(row.next_billing_at);
  const graceUntil = parseTimestamp(row.grace_until);
  const expiresAt = parseTimestamp(row.expires_at);
  if (!expiresAt) {
    throw new Error(`Failed to determine expiration for subscription ${row.id}`);
  }

  return {
    id: row.id,
    userId: row.user_id,
    chatId,
    telegramId,
    status: row.status,
    nextBillingAt,
    graceUntil,
    expiresAt,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
  } satisfies SubscriptionWithUser;
};

export const findSubscriptionsExpiringSoon = async (
  now: Date,
  warnUntil: Date,
  warnHoursBefore: number,
): Promise<SubscriptionWithUser[]> => {
  const { rows } = await pool.query<SubscriptionRow>(
    `
      SELECT
        s.id,
        s.user_id,
        s.chat_id,
        s.status,
        s.next_billing_at,
        s.grace_until,
        COALESCE(s.grace_until, s.next_billing_at) AS expires_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.last_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = ANY($3::text[])
        AND COALESCE(s.grace_until, s.next_billing_at) IS NOT NULL
        AND COALESCE(s.grace_until, s.next_billing_at) > $1
        AND COALESCE(s.grace_until, s.next_billing_at) <= $2
        AND NOT EXISTS (
          SELECT 1
          FROM subscription_events e
          WHERE e.subscription_id = s.id
            AND e.event_type = 'expiration_warning_sent'
            AND e.created_at >= COALESCE(s.grace_until, s.next_billing_at) - make_interval(hours => $4)
        )
      ORDER BY COALESCE(s.grace_until, s.next_billing_at) ASC
    `,
    [now, warnUntil, ACTIVE_SUBSCRIPTION_STATUSES, warnHoursBefore],
  );

  return rows.map(mapSubscriptionRow);
};

export const findSubscriptionsToExpire = async (
  now: Date,
): Promise<SubscriptionWithUser[]> => {
  const { rows } = await pool.query<SubscriptionRow>(
    `
      SELECT
        s.id,
        s.user_id,
        s.chat_id,
        s.status,
        s.next_billing_at,
        s.grace_until,
        COALESCE(s.grace_until, s.next_billing_at) AS expires_at,
        u.telegram_id,
        u.username,
        u.first_name,
        u.last_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = ANY($2::text[])
        AND COALESCE(s.grace_until, s.next_billing_at) IS NOT NULL
        AND COALESCE(s.grace_until, s.next_billing_at) <= $1
      ORDER BY COALESCE(s.grace_until, s.next_billing_at) ASC
    `,
    [now, ACTIVE_SUBSCRIPTION_STATUSES],
  );

  return rows.map(mapSubscriptionRow);
};

export const recordSubscriptionWarning = async (
  subscriptionId: string,
  expiresAt: Date,
): Promise<void> => {
  await pool.query(
    `
      INSERT INTO subscription_events (subscription_id, event_type, payload)
      VALUES ($1, $2, $3::jsonb)
    `,
    [
      subscriptionId,
      'expiration_warning_sent',
      JSON.stringify({ expiresAt: expiresAt.toISOString() }),
    ],
  );
};

const insertSubscriptionEvent = async (
  client: PoolClient,
  subscriptionId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await client.query(
    `
      INSERT INTO subscription_events (subscription_id, event_type, payload)
      VALUES ($1, $2, $3::jsonb)
    `,
    [subscriptionId, eventType, JSON.stringify(payload)],
  );
};

export const markSubscriptionsExpired = async (
  subscriptionIds: readonly string[],
  expiredAt: Date,
): Promise<void> => {
  if (subscriptionIds.length === 0) {
    return;
  }

  await withTx(async (client) => {
    await client.query(
      `
        UPDATE subscriptions
        SET status = 'expired',
            ended_at = $2,
            updated_at = $2
        WHERE id = ANY($1::uuid[])
          AND status <> 'expired'
      `,
      [subscriptionIds, expiredAt],
    );

    for (const subscriptionId of subscriptionIds) {
      await insertSubscriptionEvent(client, subscriptionId, 'expired', {
        expiredAt: expiredAt.toISOString(),
      });
    }
  });
};
