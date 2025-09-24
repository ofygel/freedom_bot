import type { PoolClient } from './client';
import { pool, withTx } from './client';

type ExecutorRole = 'courier' | 'driver';

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'rejected'
  | 'expired';

interface TelegramUserDetails {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  role: ExecutorRole;
}

interface SubscriptionRow {
  id: string | number;
  short_id?: string | null;
  user_id: string | number;
  chat_id: string | number;
  status: SubscriptionStatus;
  days: number | string | null;
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
  shortId: string;
  chatId: number;
  telegramId: number;
  status: SubscriptionStatus;
  periodDays: number;
  nextBillingAt?: Date;
  graceUntil?: Date;
  expiresAt: Date;
  lastWarningAt?: Date;
  username?: string;
  firstName?: string;
  lastName?: string;
}

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['active'];

interface ExistingSubscriptionRow {
  id: string | number;
  next_billing_at: Date | string | null;
  grace_until: Date | string | null;
  metadata: Record<string, unknown> | null;
}

interface ActiveSubscriptionRow {
  id: string | number;
  chat_id: string | number;
  next_billing_at: Date | string | null;
  grace_until: Date | string | null;
}

export interface ActiveSubscriptionDetails {
  id: number;
  chatId: number;
  nextBillingAt?: Date;
  graceUntil?: Date;
  expiresAt?: Date;
}

export interface ActivateSubscriptionParams extends TelegramUserDetails {
  chatId: number;
  periodDays: number;
  periodLabel?: string;
  amount: number;
  currency: string;
  paymentId: string;
  submittedAt?: Date;
  paymentMetadata?: Record<string, unknown>;
  receiptFileId?: string;
}

export interface ActivateSubscriptionResult {
  subscriptionId: number;
  telegramId: number;
  periodStart: Date;
  periodEnd: Date;
  nextBillingAt: Date;
}

export type TrialSubscriptionErrorReason = 'already_used' | 'active';

export class TrialSubscriptionUnavailableError extends Error {
  constructor(
    public readonly reason: TrialSubscriptionErrorReason,
    message?: string,
  ) {
    super(message ?? 'Trial subscription is unavailable');
    this.name = 'TrialSubscriptionUnavailableError';
  }
}

export interface CreateTrialSubscriptionParams extends TelegramUserDetails {
  chatId: number;
  trialDays: number;
  currency: string;
  now?: Date;
}

export interface TrialSubscriptionResult {
  subscriptionId: number;
  expiresAt: Date;
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

const mapActiveSubscriptionRow = (
  row: ActiveSubscriptionRow,
): ActiveSubscriptionDetails => {
  const id = parseNumeric(row.id);
  if (id === undefined) {
    throw new Error(`Failed to parse subscription id: ${row.id}`);
  }

  const chatId = parseNumeric(row.chat_id);
  if (chatId === undefined) {
    throw new Error(`Failed to parse subscription chat id for ${row.id}`);
  }

  const nextBillingAt = parseTimestamp(row.next_billing_at);
  const graceUntil = parseTimestamp(row.grace_until);
  const expiresAt = graceUntil ?? nextBillingAt;

  return { id, chatId, nextBillingAt, graceUntil, expiresAt } satisfies ActiveSubscriptionDetails;
};

const mapSubscriptionRow = (row: SubscriptionRow): SubscriptionWithUser => {
  const id = parseNumeric(row.id);
  if (id === undefined) {
    throw new Error(`Failed to parse subscription id: ${row.id}`);
  }

  const shortIdRaw =
    typeof row.short_id === 'string' ? row.short_id.trim() : undefined;
  const shortId = shortIdRaw && shortIdRaw.length > 0 ? shortIdRaw : String(id);

  const telegramId = parseNumeric(row.user_id);
  if (telegramId === undefined) {
    throw new Error(`Failed to parse subscription telegram id for ${row.id}`);
  }

  const chatId = parseNumeric(row.chat_id);
  if (chatId === undefined) {
    throw new Error(
      `Failed to parse chat id for subscription ${row.id}: ${row.chat_id}`,
    );
  }

  const periodDaysRaw = parseNumeric(row.days);
  const periodDays = periodDaysRaw === undefined ? 0 : periodDaysRaw;

  const nextBillingAt = parseTimestamp(row.next_billing_at);
  const graceUntil = parseTimestamp(row.grace_until);
  const expiresAt = parseTimestamp(row.expires_at);
  const lastWarningAt = parseTimestamp(row.last_warning_at);
  if (!expiresAt) {
    throw new Error(`Failed to determine expiration for subscription ${row.id}`);
  }

  return {
    id,
    shortId,
    chatId,
    telegramId,
    status: row.status,
    periodDays,
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
  params: TelegramUserDetails,
): Promise<number> => {
  await client.query(
    `
      INSERT INTO users (
        tg_id,
        username,
        first_name,
        last_name,
        phone,
        role,
        status,
        last_menu_role,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
      ON CONFLICT (tg_id) DO UPDATE
      SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        role = CASE WHEN users.role = 'moderator' THEN users.role ELSE EXCLUDED.role END,
        status = CASE
          WHEN users.status IN ('suspended', 'banned') THEN users.status
          ELSE COALESCE(EXCLUDED.status, users.status)
        END,
        last_menu_role = COALESCE(EXCLUDED.last_menu_role, users.last_menu_role),
        updated_at = now()
    `,
    [
      params.telegramId,
      params.username ?? null,
      params.firstName ?? null,
      params.lastName ?? null,
      params.phone ?? null,
      params.role,
      'active_executor',
      'courier',
    ],
  );

  return params.telegramId;
};

const fetchSubscriptionForUpdate = async (
  client: PoolClient,
  telegramId: number,
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
    [telegramId, chatId],
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
    const telegramId = await upsertTelegramUser(client, params);
    const existing = await fetchSubscriptionForUpdate(
      client,
      telegramId,
      params.chatId,
    );

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
              days = $6,
              next_billing_at = $7,
              grace_until = NULL,
              cancel_at_period_end = false,
              cancelled_at = NULL,
              ended_at = NULL,
              metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
              last_warning_at = NULL,
              updated_at = $9
          WHERE id = $1
          RETURNING id
        `,
        [
          existing.id,
          'manual',
          params.amount,
          params.currency,
          periodDays,
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
            days,
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
            $8,
            NULL,
            false,
            NULL,
            NULL,
            $9::jsonb
          )
          RETURNING id
        `,
        [
          telegramId,
          params.chatId,
          'manual',
          params.currency,
          params.amount,
          periodDays,
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
          days,
          file_id,
          metadata
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          'manual',
          $6,
          NULL,
          NULL,
          NULL,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12::jsonb
        )
      `,
      [
        subscriptionId,
        telegramId,
        params.amount,
        params.currency,
        'active',
        params.paymentId,
        periodStart,
        periodEnd,
        submittedAt,
        periodDays,
        params.receiptFileId ?? null,
        JSON.stringify(params.paymentMetadata ?? {}),
      ],
    );

    return {
      subscriptionId,
      telegramId,
      periodStart,
      periodEnd,
      nextBillingAt: periodEnd,
    } satisfies ActivateSubscriptionResult;
  });
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const ensureMetadataRecord = (
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return { ...metadata };
};

const hasUsedTrial = (metadata: Record<string, unknown> | null | undefined): boolean => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return false;
  }

  const record = metadata as Record<string, unknown>;
  const used = record.trialUsed;
  if (typeof used === 'boolean') {
    return used;
  }

  const activatedAt = record.trialActivatedAt;
  return typeof activatedAt === 'string' && activatedAt.trim().length > 0;
};

export const createTrialSubscription = async (
  params: CreateTrialSubscriptionParams,
): Promise<TrialSubscriptionResult> => {
  const trialDays = Math.max(1, Math.floor(params.trialDays));
  const now = params.now ?? new Date();
  const nextBillingAt = new Date(now.getTime() + trialDays * DAY_IN_MS);

  return withTx(async (client) => {
    const telegramId = await upsertTelegramUser(client, params);
    const existing = await fetchSubscriptionForUpdate(client, telegramId, params.chatId);

    if (existing && hasUsedTrial(existing.metadata)) {
      throw new TrialSubscriptionUnavailableError('already_used', 'Trial period already used');
    }

    const currentExpiration = existing
      ? parseTimestamp(existing.grace_until) ?? parseTimestamp(existing.next_billing_at)
      : undefined;
    if (currentExpiration && currentExpiration.getTime() > now.getTime()) {
      throw new TrialSubscriptionUnavailableError('active', 'An active subscription already exists');
    }

    const metadata = ensureMetadataRecord(existing?.metadata);
    metadata.trialUsed = true;
    metadata.trialActivatedAt = now.toISOString();
    metadata.trialDays = trialDays;
    metadata.trialExpiresAt = nextBillingAt.toISOString();

    const payload = [
      params.currency,
      trialDays,
      nextBillingAt,
      JSON.stringify(metadata),
      now,
    ] as const;

    if (existing) {
      const { rows } = await client.query<{ id: string | number; next_billing_at: Date | string | null }>(
        `
          UPDATE subscriptions
          SET plan = 'trial',
              tier = NULL,
              status = 'active',
              currency = $2,
              amount = 0,
              interval = 'day',
              interval_count = $3,
              days = $3,
              next_billing_at = $4,
              grace_until = NULL,
              cancel_at_period_end = false,
              cancelled_at = NULL,
              ended_at = NULL,
              metadata = $5::jsonb,
              last_warning_at = NULL,
              updated_at = $6
          WHERE id = $1
          RETURNING id, next_billing_at
        `,
        [existing.id, ...payload],
      );

      const [row] = rows;
      const subscriptionId = parseNumeric(row?.id ?? existing.id);
      if (subscriptionId === undefined) {
        throw new Error(`Failed to determine subscription id for ${existing.id}`);
      }

      return {
        subscriptionId,
        expiresAt: nextBillingAt,
      } satisfies TrialSubscriptionResult;
    }

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
          days,
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
          'trial',
          NULL,
          'active',
          $3,
          0,
          'day',
          $4,
          $4,
          $5,
          NULL,
          false,
          NULL,
          NULL,
          $6::jsonb
        )
        RETURNING id
      `,
      [telegramId, params.chatId, params.currency, trialDays, nextBillingAt, JSON.stringify(metadata)],
    );

    const [row] = rows;
    if (!row) {
      throw new Error('Failed to create trial subscription');
    }

    const subscriptionId = parseNumeric(row.id);
    if (subscriptionId === undefined) {
      throw new Error(`Failed to parse subscription id returned from insert (${row.id})`);
    }

    return {
      subscriptionId,
      expiresAt: nextBillingAt,
    } satisfies TrialSubscriptionResult;
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
        s.days,
        s.next_billing_at,
        s.grace_until,
        COALESCE(s.grace_until, s.next_billing_at) AS expires_at,
        s.last_warning_at,
        u.tg_id,
        u.username,
        u.first_name,
        u.last_name
      FROM subscriptions s
      JOIN users u ON u.tg_id = s.user_id
      WHERE s.status = ANY($3::subscription_status[])
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
        s.days,
        s.next_billing_at,
        s.grace_until,
        COALESCE(s.grace_until, s.next_billing_at) AS expires_at,
        s.last_warning_at,
        u.tg_id,
        u.username,
        u.first_name,
        u.last_name
      FROM subscriptions s
      JOIN users u ON u.tg_id = s.user_id
      WHERE s.status = ANY($2::subscription_status[])
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
      WHERE s.chat_id = $1
        AND s.user_id = $2
        AND s.status = ANY($3::subscription_status[])
        AND COALESCE(s.grace_until, s.next_billing_at) > now()
      LIMIT 1
    `,
    [chatId, telegramId, ACTIVE_SUBSCRIPTION_STATUSES],
  );

  return rows.length > 0;
};

export const findActiveSubscriptionForUser = async (
  chatId: number,
  telegramId: number,
): Promise<ActiveSubscriptionDetails | null> => {
  const { rows } = await pool.query<ActiveSubscriptionRow>(
    `
      SELECT id, chat_id, next_billing_at, grace_until
      FROM subscriptions
      WHERE chat_id = $1
        AND user_id = $2
        AND status = ANY($3::subscription_status[])
        AND COALESCE(grace_until, next_billing_at) > now()
      ORDER BY COALESCE(grace_until, next_billing_at) DESC NULLS LAST
      LIMIT 1
    `,
    [chatId, telegramId, ACTIVE_SUBSCRIPTION_STATUSES],
  );

  const [row] = rows;
  if (!row) {
    return null;
  }

  return mapActiveSubscriptionRow(row);
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
