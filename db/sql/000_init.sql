-- Base schema for the Freedom Bot database aligned with the latest runtime expectations.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Domain types mirroring runtime enums.
DO $$
BEGIN
    CREATE TYPE user_role AS ENUM ('client', 'executor', 'moderator');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE order_kind AS ENUM ('taxi', 'delivery');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE order_status AS ENUM ('open', 'claimed', 'cancelled', 'done');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE verification_role AS ENUM ('courier', 'driver');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE subscription_status AS ENUM (
        'active',
        'trialing',
        'past_due',
        'canceled',
        'expired',
        'paused'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS users (
    id bigserial PRIMARY KEY,
    telegram_id bigint NOT NULL UNIQUE,
    username text,
    first_name text,
    last_name text,
    phone text,
    role user_role NOT NULL DEFAULT 'client',
    is_verified boolean NOT NULL DEFAULT false,
    marketing_opt_in boolean NOT NULL DEFAULT false,
    is_blocked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
    id boolean PRIMARY KEY DEFAULT true,
    verify_channel_id bigint,
    drivers_channel_id bigint
);

INSERT INTO channels (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS verifications (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role verification_role NOT NULL,
    status verification_status NOT NULL DEFAULT 'pending',
    photos_required integer NOT NULL DEFAULT 0,
    photos_uploaded integer NOT NULL DEFAULT 0,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id bigserial PRIMARY KEY,
    kind order_kind NOT NULL,
    status order_status NOT NULL DEFAULT 'open',
    client_id bigint,
    client_phone text,
    customer_name text,
    customer_username text,
    client_comment text,
    claimed_by bigint,
    claimed_at timestamptz,
    completed_at timestamptz,
    pickup_query text NOT NULL,
    pickup_address text NOT NULL,
    pickup_lat double precision NOT NULL,
    pickup_lon double precision NOT NULL,
    dropoff_query text NOT NULL,
    dropoff_address text NOT NULL,
    dropoff_lat double precision NOT NULL,
    dropoff_lon double precision NOT NULL,
    price_amount integer NOT NULL,
    price_currency text NOT NULL,
    distance_km double precision NOT NULL,
    channel_message_id bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id bigint NOT NULL,
    plan text NOT NULL,
    tier text,
    status subscription_status NOT NULL DEFAULT 'active',
    currency text NOT NULL,
    amount integer NOT NULL,
    interval text NOT NULL,
    interval_count integer NOT NULL DEFAULT 1,
    next_billing_at timestamptz,
    grace_until timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    ended_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_warning_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id bigserial PRIMARY KEY,
    subscription_id bigint NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount integer NOT NULL,
    currency text NOT NULL,
    status text NOT NULL,
    payment_provider text NOT NULL,
    provider_payment_id text,
    provider_customer_id text,
    invoice_url text,
    receipt_url text,
    period_start timestamptz,
    period_end timestamptz,
    paid_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_payment_id)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_verifications_user_role_status ON verifications(user_id, role, status);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON orders(claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_chat_id ON subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
