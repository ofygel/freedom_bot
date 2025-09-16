import type { PoolClient } from './client';
import { pool, withTx } from './client';

type ExecutorRole = 'courier' | 'driver';

export type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'paused';

interface SubscriptionRow {
  id: string | number;
  user_id: string | number;
  chat_id: string | number;
  status: SubscriptionStatus;
  next_billing_at: Date | string | null;
  grace_until: Date | string | null;
  expires_at: Date | string | null;
  last_warning_at: Date | string | null;
  tg_id: string | number | null;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface SubscriptionWithUser {
  id: number;
  userId: number;
  chatId: number;
  telegramId?: number;
  status: SubscriptionStatus;
  nextBillingAt?: Date;
  graceUntil?: Date;
  expiresAt: Date;
  lastWarningAt?: Date;
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
  id: string | number;
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
  role: ExecutorRole;
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
  subscriptionId: number;
  userId: number;
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
  const id = parseNumeric(row.id);
  if (id === undefined) {
    throw new Error(`Failed to parse subscription id: ${row.id}`);
  }

  const userId = parseNumeric(row.user_id);
  if (userId === undefined) {
    throw new Error(`Failed to parse subscription user id for ${row.id}`);
  }

  const chatId = parseNumeric(row.chat_id);
  if (chatId === undefined) {
    throw new Error(
      `Failed to parse chat id for subscription ${row.id}: ${row.chat_id}`,
    );
  }

  const telegramId = parseNumeric(row.tg_id ?? undefined);
  const nextBillingAt = parseTimestamp(row.next_billing_at);
  const graceUntil = parseTimestamp(row.grace_until);
  const expiresAt = parseTimestamp(row.expires_at);
  const lastWarningAt = parseTimestamp(row.last_warning_at);
  if (!expiresAt) {
    throw new Error(`Failed to determine expiration for subscription ${row.id}`);
  }

  return {
    id,
    userId,
    chatId,
    telegramId,
    status: row.status,
    nextBillingAt,
    graceUntil,
    expiresAt,
    lastWarningAt,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
  } satisfies SubscriptionWithUser;
};

const upsertTelegramUser = async (
  client: PoolClient,
  params: ActivateSubscriptionParams,
): Promise<number> => {
  const { rows } = await client.query<{ id: string | number }>(
    `
      INSERT INTO users (
        tg_id,
        username,
        first_name,
        last_name,
        phone,
        role,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (tg_id) DO UPDATE
      SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        role = CASE WHEN users.role = 'moderator' THEN users.role ELSE EXCLUDED.role END,
        updated_at = now()
      RETURNING id
    `,
    [
      params.telegramId,
      params.username ?? null,
      params.firstName ?? null,
      params.lastName ?? null,
      params.phone ?? null,
      params.role,
    ],
  );

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to upsert telegram user for subscription activation');
  }

  const userId = parseNumeric(row.id);
  if (userId === undefined) {
    throw new Error(`Failed to parse user id returned from upsert (${row.id})`);
  }

  return userId;
};

const fetchSubscriptionForUpdate = async (
  client: PoolClient,
  userId: number,
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

    let subscriptionId: number;
    if (existing) {
      const { rows } = await client.query<{ id: string | number }>(
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
              last_warning_at = NULL,
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
      const parsedId = parseNumeric(row?.id ?? existing.id);
      if (parsedId === undefined) {
        throw new Error(`Failed to determine subscription id for ${existing.id}`);
      }
      subscriptionId = parsedId;
    } else {
      const { rows } = await client.query<{ id: string | number }>(
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
      const parsedId = parseNumeric(row.id);
      if (parsedId === undefined) {
        throw new Error(`Failed to parse subscription id returned from insert (${row.id})`);
      }
      subscriptionId = parsedId;
    }

    await client.query(
      `
        INSERT INTO payments (
          subscription_id,
          user_id,
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
          $4,
          'succeeded',
          'manual',
          $5,
          NULL,
          NULL,
          NULL,
          $6,
          $7,
          $8,
          $9::jsonb
        )
      `,
      [
        subscriptionId,
        userId,
        params.amount,
        params.currency,
        params.paymentId,
        periodStart,
        periodEnd,
        submittedAt,
        JSON.stringify(params.paymentMetadata ?? {}),
      ],
    );

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
        s.last_warning_at,
        u.tg_id,
        u.username,
        u.first_name,
        u.last_name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = ANY($3::text[])
        AND COALESCE(s.grace_until, s.next_billing_at) IS NOT NULL
        AND COALESCE(s.grace_until, s.next_billing_at) > $1
        AND COALESCE(s.grace_until, s.next_billing_at) <= $2
        AND (
          s.last_warning_at IS NULL
          OR s.last_warning_at < COALESCE(s.grace_until, s.next_billing_at) - make_interval(hours => $4)
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
        s.last_warning_at,
        u.tg_id,
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
  subscriptionId: number,
  warnedAt: Date,
): Promise<void> => {
  await pool.query(
    `
      UPDATE subscriptions
      SET last_warning_at = $2,
          updated_at = GREATEST(updated_at, $2)
      WHERE id = $1
    `,
    [subscriptionId, warnedAt],
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
        AND u.tg_id = $2
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

export const markSubscriptionsExpired = async (
  subscriptionIds: readonly number[],
  expiredAt: Date,
): Promise<void> => {
  if (subscriptionIds.length === 0) {
    return;
  }

  await pool.query(
    `
      UPDATE subscriptions
      SET status = 'expired',
          ended_at = $2,
          updated_at = $2,
          last_warning_at = NULL
      WHERE id = ANY($1::bigint[])
        AND status <> 'expired'
    `,
    [subscriptionIds, expiredAt],
  );
};
