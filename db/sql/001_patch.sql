-- Idempotent patch ensuring the runtime schema matches the expected structure.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure enum types exist and contain required values.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('client', 'courier', 'driver');
    END IF;
END
$$;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'courier';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'driver';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_kind') THEN
        CREATE TYPE order_kind AS ENUM ('taxi', 'delivery');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        CREATE TYPE order_status AS ENUM ('open', 'claimed', 'cancelled', 'done');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_role') THEN
        CREATE TYPE verification_role AS ENUM ('courier', 'driver');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
    END IF;
END
$$;

ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'cancelled';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        CREATE TYPE subscription_status AS ENUM (
            'active',
            'trialing',
            'past_due',
            'canceled',
            'expired',
            'paused'
        );
    END IF;
END
$$;

-- Create tables when missing so later alterations succeed.
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

CREATE TABLE IF NOT EXISTS callback_map (
    token text PRIMARY KEY,
    action text NOT NULL,
    chat_id bigint,
    message_id bigint,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    scope text NOT NULL,
    scope_id bigint NOT NULL,
    state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, scope_id)
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS scope text,
    ADD COLUMN IF NOT EXISTS scope_id bigint,
    ADD COLUMN IF NOT EXISTS state jsonb,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE sessions ALTER COLUMN scope SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'Skipping NOT NULL on sessions.scope due to existing null values.';
    END;

    BEGIN
        ALTER TABLE sessions ALTER COLUMN scope_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'Skipping NOT NULL on sessions.scope_id due to existing null values.';
    END;

    BEGIN
        ALTER TABLE sessions ALTER COLUMN state SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'Skipping NOT NULL on sessions.state due to existing null values.';
    END;
END
$$;

ALTER TABLE sessions
    ALTER COLUMN created_at SET DEFAULT now(),
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE sessions ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'Skipping NOT NULL on sessions.created_at due to existing null values.';
    END;

    BEGIN
        ALTER TABLE sessions ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            RAISE NOTICE 'Skipping NOT NULL on sessions.updated_at due to existing null values.';
    END;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'sessions'::regclass
          AND contype = 'p'
    )
    THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_pkey PRIMARY KEY (scope, scope_id);
    END IF;
END
$$;

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

-- Column adjustments for legacy databases.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'telegram_id'
    )
    THEN
        EXECUTE 'ALTER TABLE users RENAME COLUMN telegram_id TO tg_id';
    END IF;
END
$$;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS username text,
    ADD COLUMN IF NOT EXISTS first_name text,
    ADD COLUMN IF NOT EXISTS last_name text,
    ADD COLUMN IF NOT EXISTS phone text,
    ADD COLUMN IF NOT EXISTS role user_role;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE users
    ALTER COLUMN role SET DEFAULT 'client';

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'role'
    )
    THEN
        BEGIN
            ALTER TABLE users ALTER COLUMN role SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                RAISE NOTICE 'Skipping NOT NULL on users.role due to existing null values.';
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'tg_id'
    )
    THEN
        BEGIN
            ALTER TABLE users ALTER COLUMN tg_id TYPE bigint USING tg_id::bigint;
        EXCEPTION
            WHEN invalid_text_representation THEN
                RAISE NOTICE 'Skipping tg_id type coercion due to incompatible data.';
        END;

        BEGIN
            ALTER TABLE users ALTER COLUMN tg_id SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                RAISE NOTICE 'Skipping NOT NULL on users.tg_id due to existing null values.';
        END;
    END IF;
END
$$;

-- Bring legacy verification counters up to date.
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS photos_required integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS photos_uploaded integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Extend orders with the required bookkeeping columns.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS client_phone text,
    ADD COLUMN IF NOT EXISTS customer_name text,
    ADD COLUMN IF NOT EXISTS customer_username text,
    ADD COLUMN IF NOT EXISTS client_comment text,
    ADD COLUMN IF NOT EXISTS claimed_by bigint,
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
    ADD COLUMN IF NOT EXISTS completed_at timestamptz,
    ADD COLUMN IF NOT EXISTS channel_message_id bigint,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Subscription table safety checks.
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS tier text,
    ADD COLUMN IF NOT EXISTS next_billing_at timestamptz,
    ADD COLUMN IF NOT EXISTS grace_until timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS ended_at timestamptz,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS last_warning_at timestamptz,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'subscriptions_user_chat_unique'
    )
    THEN
        ALTER TABLE subscriptions
            ADD CONSTRAINT subscriptions_user_chat_unique UNIQUE (user_id, chat_id);
    END IF;
END
$$;

-- Payment table safety checks.
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_payment_id text,
    ADD COLUMN IF NOT EXISTS provider_customer_id text,
    ADD COLUMN IF NOT EXISTS invoice_url text,
    ADD COLUMN IF NOT EXISTS receipt_url text,
    ADD COLUMN IF NOT EXISTS period_start timestamptz,
    ADD COLUMN IF NOT EXISTS period_end timestamptz,
    ADD COLUMN IF NOT EXISTS paid_at timestamptz,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Support thread constraint enforcement.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.constraint_column_usage
        WHERE table_name = 'support_threads'
          AND constraint_name = 'support_threads_status_check'
    )
    THEN
        ALTER TABLE support_threads
            ADD CONSTRAINT support_threads_status_check CHECK (status IN ('open', 'closed'));
    END IF;
END
$$;

-- Seed the singleton channels row.
INSERT INTO channels (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- Create helper indexes required by the application.
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
