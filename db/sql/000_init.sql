-- Base schema for the Freedom Bot database aligned with runtime services.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Domain types mirroring runtime enums.
DO $$
BEGIN
    CREATE TYPE order_kind AS ENUM ('taxi', 'delivery');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE order_status AS ENUM ('new', 'claimed', 'cancelled');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    CREATE TYPE verification_type AS ENUM ('courier', 'driver');
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
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id bigint NOT NULL UNIQUE,
    username text,
    first_name text,
    last_name text,
    phone text,
    is_courier boolean NOT NULL DEFAULT false,
    is_blocked boolean NOT NULL DEFAULT false,
    marketing_opt_in boolean NOT NULL DEFAULT false,
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
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type verification_type NOT NULL,
    status verification_status NOT NULL DEFAULT 'pending',
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
    id bigserial PRIMARY KEY,
    kind order_kind NOT NULL,
    status order_status NOT NULL DEFAULT 'new',
    client_id bigint,
    client_phone text,
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
    metadata jsonb,
    channel_message_id bigint,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
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
    metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_payment_id)
);

CREATE TABLE IF NOT EXISTS subscription_events (
    id bigserial PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription_id ON subscription_payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_id ON subscription_events(subscription_id);
