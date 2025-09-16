-- Base schema for the Freedom Bot database aligned with the application specification.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Domain types used throughout the schema.
DO $$
BEGIN
    CREATE TYPE user_role AS ENUM ('client', 'courier', 'driver');
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

-- Core reference data.
CREATE TABLE IF NOT EXISTS users (
    id bigserial PRIMARY KEY,
    tg_id bigint NOT NULL,
    username text,
    first_name text,
    last_name text,
    phone text,
    role user_role NOT NULL DEFAULT 'client',
    is_verified boolean NOT NULL DEFAULT false,
    marketing_opt_in boolean NOT NULL DEFAULT false,
    is_blocked boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tg_id)
);

CREATE TABLE IF NOT EXISTS channels (
    id boolean PRIMARY KEY DEFAULT true,
    verify_channel_id bigint,
    drivers_channel_id bigint
);

INSERT INTO channels (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- Verification workflow.
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

CREATE TABLE IF NOT EXISTS verification_photos (
    id bigserial PRIMARY KEY,
    verification_id bigint NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
    file_id text NOT NULL,
    file_unique_id text,
    file_size integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Order management.
CREATE TABLE IF NOT EXISTS orders (
    id bigserial PRIMARY KEY,
    kind order_kind NOT NULL,
    status order_status NOT NULL DEFAULT 'open',
    client_id bigint REFERENCES users(id) ON DELETE SET NULL,
    client_phone text,
    customer_name text,
    customer_username text,
    client_comment text,
    claimed_by bigint REFERENCES users(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS order_channel_posts (
    id bigserial PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    channel_id bigint NOT NULL,
    message_id bigint NOT NULL,
    thread_id bigint,
    published_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, channel_id)
);

-- Subscription billing.
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

-- Generic callback storage used by interactive flows.
CREATE TABLE IF NOT EXISTS callback_map (
    token text PRIMARY KEY,
    action text NOT NULL,
    chat_id bigint,
    message_id bigint,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Support conversations between users and moderators.
CREATE TABLE IF NOT EXISTS support_threads (
    id text PRIMARY KEY,
    user_chat_id bigint NOT NULL,
    user_tg_id bigint,
    user_message_id bigint NOT NULL,
    moderator_chat_id bigint NOT NULL,
    moderator_message_id bigint NOT NULL,
    status text NOT NULL DEFAULT 'open',
    closed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT support_threads_status_check CHECK (status IN ('open', 'closed'))
);

-- Indexes optimising frequent lookups.
CREATE INDEX IF NOT EXISTS idx_users_tg_id ON users(tg_id);
CREATE INDEX IF NOT EXISTS idx_verifications_user_role_status ON verifications(user_id, role, status);
CREATE INDEX IF NOT EXISTS idx_verification_photos_verification_id ON verification_photos(verification_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON orders(claimed_by);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_channel_posts_order_id ON order_channel_posts(order_id);
CREATE INDEX IF NOT EXISTS idx_order_channel_posts_channel_message ON order_channel_posts(channel_id, message_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_chat_id ON subscriptions(chat_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_callback_map_expires_at ON callback_map(expires_at);
CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads(status);
CREATE INDEX IF NOT EXISTS idx_support_threads_moderator_message ON support_threads(moderator_chat_id, moderator_message_id);
