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

interface ExistingSubscriptionRow {
  id: string;
  next_billing_at: Date | string | null;
  grace_until: Date | string | null;
  metadata: Record<string, unknown> | null;
}

export interface ActivateSubscriptionParams {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  chatId: number;
  periodDays: number;
  periodLabel?: string;
  amount: number;
  currency: string;
  paymentId: string;
  submittedAt?: Date;
  paymentMetadata?: Record<string, unknown>;
}

export interface ActivateSubscriptionResult {
  subscriptionId: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  nextBillingAt: Date;
}

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

const upsertTelegramUser = async (
  client: PoolClient,
  params: ActivateSubscriptionParams,
): Promise<string> => {
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO users (
        telegram_id,
        username,
        first_name,
        last_name,
        phone,
        is_courier,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, true, now())
      ON CONFLICT (telegram_id) DO UPDATE
      SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        is_courier = true,
        updated_at = now()
      RETURNING id
    `,
    [
      params.telegramId,
      params.username ?? null,
      params.firstName ?? null,
      params.lastName ?? null,
      params.phone ?? null,
    ],
  );

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to upsert telegram user for subscription activation');
  }

  return row.id;
};

const fetchSubscriptionForUpdate = async (
  client: PoolClient,
  userId: string,
  chatId: number,
): Promise<ExistingSubscriptionRow | null> => {
  const { rows } = await client.query<ExistingSubscriptionRow>(
    `
      SELECT id, next_billing_at, grace_until, metadata
      FROM subscriptions
      WHERE user_id = $1 AND chat_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [userId, chatId],
  );

  const [row] = rows;
  return row ?? null;
};

const determinePeriodStart = (
  existing: ExistingSubscriptionRow | null,
  submittedAt: Date,
): Date => {
  if (!existing) {
    return submittedAt;
  }

  const expiration =
    parseTimestamp(existing.grace_until) ?? parseTimestamp(existing.next_billing_at);
  if (expiration && expiration.getTime() > submittedAt.getTime()) {
    return expiration;
  }

  return submittedAt;
};

const buildMetadataPatch = (
  params: ActivateSubscriptionParams,
  periodEnd: Date,
  submittedAt: Date,
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {
    lastPaymentId: params.paymentId,
    lastPaymentAt: submittedAt.toISOString(),
    lastPeriodDays: params.periodDays,
    lastPeriodEnd: periodEnd.toISOString(),
  };

  if (params.periodLabel) {
    patch.lastPeriodLabel = params.periodLabel;
  }

  return patch;
};

export const activateSubscription = async (
  params: ActivateSubscriptionParams,
): Promise<ActivateSubscriptionResult> => {
  const submittedAt = params.submittedAt ?? new Date();
  const periodDays = Math.max(1, params.periodDays);

  return withTx(async (client) => {
    const userId = await upsertTelegramUser(client, params);
    const existing = await fetchSubscriptionForUpdate(client, userId, params.chatId);

    const periodStart = determinePeriodStart(existing, submittedAt);
    const periodEnd = new Date(periodStart.getTime() + periodDays * 24 * 60 * 60 * 1000);
    const metadataPatch = buildMetadataPatch(params, periodEnd, submittedAt);

    let subscriptionId: string;
    if (existing) {
      const { rows } = await client.query<{ id: string }>(
        `
          UPDATE subscriptions
          SET plan = $2,
              status = 'active',
              amount = $3,
              currency = $4,
              interval = 'day',
              interval_count = $5,
              next_billing_at = $6,
              grace_until = NULL,
              cancel_at_period_end = false,
              cancelled_at = NULL,
              ended_at = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
              updated_at = $8
          WHERE id = $1
          RETURNING id
        `,
        [
          existing.id,
          'manual',
          params.amount,
          params.currency,
          periodDays,
          periodEnd,
          JSON.stringify(metadataPatch),
          submittedAt,
        ],
      );

      const [row] = rows;
      subscriptionId = row?.id ?? existing.id;
    } else {
      const { rows } = await client.query<{ id: string }>(
        `
          INSERT INTO subscriptions (
            user_id,
            chat_id,
            plan,
            tier,
            status,
            currency,
            amount,
            interval,
            interval_count,
            next_billing_at,
            grace_until,
            cancel_at_period_end,
            cancelled_at,
            ended_at,
            metadata
          )
          VALUES (
            $1,
            $2,
            $3,
            NULL,
            'active',
            $4,
            $5,
            'day',
            $6,
            $7,
            NULL,
            false,
            NULL,
            NULL,
            $8::jsonb
          )
          RETURNING id
        `,
        [
          userId,
          params.chatId,
          'manual',
          params.currency,
          params.amount,
          periodDays,
          periodEnd,
          JSON.stringify(metadataPatch),
        ],
      );

      const [row] = rows;
      if (!row) {
        throw new Error('Failed to create subscription during activation');
      }
      subscriptionId = row.id;
    }

    await client.query(
      `
        INSERT INTO subscription_payments (
          subscription_id,
          amount,
          currency,
          status,
          payment_provider,
          provider_payment_id,
          provider_customer_id,
          invoice_url,
          receipt_url,
          period_start,
          period_end,
          paid_at,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          'succeeded',
          'manual',
          $4,
          NULL,
          NULL,
          NULL,
          $5,
          $6,
          $7,
          $8::jsonb
        )
      `,
      [
        subscriptionId,
        params.amount,
        params.currency,
        params.paymentId,
        periodStart,
        periodEnd,
        submittedAt,
        JSON.stringify(params.paymentMetadata ?? {}),
      ],
    );

    await insertSubscriptionEvent(client, subscriptionId, 'payment_applied', {
      paymentId: params.paymentId,
      amount: params.amount,
      currency: params.currency,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    });

    return {
      subscriptionId,
      userId,
      periodStart,
      periodEnd,
      nextBillingAt: periodEnd,
    } satisfies ActivateSubscriptionResult;
  });
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

export const hasActiveSubscription = async (
  chatId: number,
  telegramId: number,
): Promise<boolean> => {
  const { rows } = await pool.query<{ exists: number }>(
    `
      SELECT 1 AS exists
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.chat_id = $1
        AND u.telegram_id = $2
        AND s.status = ANY($3::text[])
        AND (
          COALESCE(s.grace_until, s.next_billing_at) IS NULL
          OR COALESCE(s.grace_until, s.next_billing_at) > now()
        )
      LIMIT 1
    `,
    [chatId, telegramId, ACTIVE_SUBSCRIPTION_STATUSES],
  );

  return rows.length > 0;
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
