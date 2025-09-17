-- Idempotent patch ensuring the runtime schema matches the expected structure.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure enum types are defined with the expected values.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'verifications'
              AND column_name = 'status'
              AND udt_name = 'verification_status'
        ) THEN
            ALTER TABLE verifications
                ALTER COLUMN status TYPE text USING status::text;
        END IF;

        UPDATE verifications
        SET status = 'approved'
        WHERE status IN ('active', 'approved', 'expired');
        UPDATE verifications
        SET status = 'rejected'
        WHERE status IN ('cancelled', 'canceled');
        UPDATE verifications
        SET status = 'pending'
        WHERE status NOT IN ('pending', 'approved', 'rejected') OR status IS NULL;

        DROP TYPE verification_status;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS verification_status AS ENUM ('pending', 'approved', 'rejected');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'verifications'
          AND column_name = 'status'
          AND udt_name <> 'verification_status'
    ) THEN
        ALTER TABLE verifications
            ALTER COLUMN status TYPE verification_status USING status::verification_status;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'verifications'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE verifications
            ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'subscriptions'
              AND column_name = 'status'
              AND udt_name = 'subscription_status'
        ) THEN
            ALTER TABLE subscriptions
                ALTER COLUMN status TYPE text USING status::text;
        END IF;

        UPDATE subscriptions SET status = 'active' WHERE status IN ('trialing', 'past_due', 'active');
        UPDATE subscriptions SET status = 'expired' WHERE status IN ('canceled', 'cancelled', 'expired');
        UPDATE subscriptions
        SET status = 'pending'
        WHERE status NOT IN ('pending', 'active', 'rejected', 'expired') OR status IS NULL;

        DROP TYPE subscription_status;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS subscription_status AS ENUM ('pending', 'active', 'rejected', 'expired');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'status'
          AND udt_name <> 'subscription_status'
    ) THEN
        ALTER TABLE subscriptions
            ALTER COLUMN status TYPE subscription_status USING status::subscription_status;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE subscriptions
            ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE payments
            ALTER COLUMN status TYPE text USING status::text;

        UPDATE payments
        SET status = 'approved'
        WHERE status IN ('succeeded', 'active', 'approved');
        UPDATE payments
        SET status = 'rejected'
        WHERE status IN ('failed', 'rejected', 'cancelled', 'canceled', 'expired');
        UPDATE payments
        SET status = 'pending'
        WHERE status NOT IN ('pending', 'approved', 'rejected') OR status IS NULL;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        DROP TYPE payment_status;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS payment_status AS ENUM ('pending', 'approved', 'rejected');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'status'
          AND udt_name <> 'payment_status'
    ) THEN
        ALTER TABLE payments
            ALTER COLUMN status TYPE payment_status USING status::payment_status;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'status'
    ) THEN
        ALTER TABLE payments
            ALTER COLUMN status SET DEFAULT 'pending';
    END IF;
END
$$;

-- Ensure tables exist so later alterations succeed.
CREATE TABLE IF NOT EXISTS users (
    tg_id       bigint      PRIMARY KEY,
    username    text,
    first_name  text,
    last_name   text,
    phone       text,
    role        user_role   NOT NULL DEFAULT 'client',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_phone_unique UNIQUE (phone)
);

DO $$
DECLARE
    has_legacy_id boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'id'
    )
    INTO has_legacy_id;

    IF has_legacy_id THEN
        UPDATE verifications v
        SET user_id = u.tg_id
        FROM users u
        WHERE v.user_id = u.id;

        UPDATE orders o
        SET client_id = u.tg_id
        FROM users u
        WHERE o.client_id = u.id;

        UPDATE orders o
        SET claimed_by = u.tg_id
        FROM users u
        WHERE o.claimed_by = u.id;

        UPDATE subscriptions s
        SET user_id = u.tg_id
        FROM users u
        WHERE s.user_id = u.id;

        UPDATE payments p
        SET user_id = u.tg_id
        FROM users u
        WHERE p.user_id = u.id;

        UPDATE support_threads st
        SET user_tg_id = u.tg_id
        FROM users u
        WHERE st.user_tg_id = u.id;

        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
        ALTER TABLE users DROP COLUMN id;
        IF EXISTS (
            SELECT 1 FROM pg_class WHERE relname = 'users_id_seq'
        ) THEN
            EXECUTE 'DROP SEQUENCE users_id_seq';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'is_verified'
    ) THEN
        ALTER TABLE users DROP COLUMN is_verified;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'marketing_opt_in'
    ) THEN
        ALTER TABLE users DROP COLUMN marketing_opt_in;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'is_blocked'
    ) THEN
        ALTER TABLE users DROP COLUMN is_blocked;
    END IF;
END
$$;

DO $$
BEGIN
    ALTER TABLE users ALTER COLUMN tg_id SET NOT NULL;
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_tg_id_unique'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_tg_id_unique;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_pkey PRIMARY KEY (tg_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_phone_unique'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_phone_unique UNIQUE (phone);
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS channels (
    id boolean PRIMARY KEY DEFAULT true,
    verify_channel_id bigint,
    drivers_channel_id bigint
);

CREATE TABLE IF NOT EXISTS verifications (
    id              bigserial PRIMARY KEY,
    user_id         bigint          NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
    role            verification_role NOT NULL,
    status          verification_status NOT NULL DEFAULT 'pending',
    photos_required integer         NOT NULL DEFAULT 0,
    photos_uploaded integer         NOT NULL DEFAULT 0,
    expires_at      timestamptz,
    created_at      timestamptz     NOT NULL DEFAULT now(),
    updated_at      timestamptz     NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_photos (
    id               bigserial PRIMARY KEY,
    verification_id  bigint      NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
    idx              integer     NOT NULL,
    file_id          text        NOT NULL,
    file_unique_id   text,
    file_size        integer,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT verification_photos_verification_idx_unique UNIQUE (verification_id, idx)
);

CREATE TABLE IF NOT EXISTS orders (
    id                bigserial PRIMARY KEY,
    short_id          text        NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8),
    kind              order_kind  NOT NULL,
    status            order_status NOT NULL DEFAULT 'open',
    client_id         bigint REFERENCES users(tg_id) ON DELETE SET NULL,
    client_phone      text,
    customer_name     text,
    customer_username text,
    client_comment    text,
    claimed_by        bigint REFERENCES users(tg_id) ON DELETE SET NULL,
    claimed_at        timestamptz,
    completed_at      timestamptz,
    pickup_query      text        NOT NULL,
    pickup_address    text        NOT NULL,
    pickup_lat        double precision NOT NULL,
    pickup_lon        double precision NOT NULL,
    dropoff_query     text        NOT NULL,
    dropoff_address   text        NOT NULL,
    dropoff_lat       double precision NOT NULL,
    dropoff_lon       double precision NOT NULL,
    price_amount      integer     NOT NULL,
    price_currency    text        NOT NULL,
    distance_km       double precision NOT NULL,
    channel_message_id bigint,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_short_id_unique UNIQUE (short_id)
);

CREATE TABLE IF NOT EXISTS order_channel_posts (
    id          bigserial PRIMARY KEY,
    order_id    bigint      NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    channel_id  bigint      NOT NULL,
    message_id  bigint      NOT NULL,
    thread_id   bigint,
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT order_channel_posts_order_channel_unique UNIQUE (order_id, channel_id),
    CONSTRAINT order_channel_posts_channel_message_unique UNIQUE (channel_id, message_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id                 bigserial PRIMARY KEY,
    short_id           text        NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8),
    user_id            bigint      NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
    chat_id            bigint      NOT NULL,
    plan               text        NOT NULL,
    status             subscription_status NOT NULL DEFAULT 'pending',
    currency           text        NOT NULL,
    amount             integer     NOT NULL,
    period_days        integer     NOT NULL DEFAULT 0,
    next_billing_at    timestamptz,
    grace_until        timestamptz,
    cancelled_at       timestamptz,
    ended_at           timestamptz,
    metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
    last_warning_at    timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_short_id_unique UNIQUE (short_id),
    CONSTRAINT subscriptions_user_chat_unique UNIQUE (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id                  bigserial PRIMARY KEY,
    short_id            text        NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8),
    subscription_id     bigint      NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    user_id             bigint      NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
    amount              integer     NOT NULL,
    currency            text        NOT NULL,
    status              payment_status NOT NULL DEFAULT 'pending',
    provider            text        NOT NULL,
    provider_payment_id text,
    invoice_url         text,
    receipt_url         text,
    period_start        timestamptz,
    period_end          timestamptz,
    paid_at             timestamptz,
    period_days         integer,
    receipt_file_id     text,
    metadata            jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT payments_short_id_unique UNIQUE (short_id),
    CONSTRAINT payments_provider_payment_unique UNIQUE (provider_payment_id)
);

CREATE TABLE IF NOT EXISTS callback_map (
    id         bigserial PRIMARY KEY,
    token      text        NOT NULL UNIQUE,
    action     text        NOT NULL,
    chat_id    bigint,
    message_id bigint,
    payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    scope      text        NOT NULL,
    scope_id   bigint      NOT NULL,
    state      jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, scope_id)
);

CREATE TABLE IF NOT EXISTS support_threads (
    id                    text PRIMARY KEY,
    user_chat_id          bigint      NOT NULL,
    user_tg_id            bigint REFERENCES users(tg_id),
    user_message_id       bigint      NOT NULL,
    moderator_chat_id     bigint      NOT NULL,
    moderator_message_id  bigint      NOT NULL,
    status                text        NOT NULL DEFAULT 'open',
    closed_at             timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT support_threads_status_check CHECK (status IN ('open', 'closed'))
);

ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_user_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_client_id_fkey;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_claimed_by_fkey;
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE support_threads DROP CONSTRAINT IF EXISTS support_threads_user_tg_id_fkey;

ALTER TABLE verifications
    ADD CONSTRAINT verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;
ALTER TABLE orders
    ADD CONSTRAINT orders_client_id_fkey FOREIGN KEY (client_id) REFERENCES users(tg_id) ON DELETE SET NULL;
ALTER TABLE orders
    ADD CONSTRAINT orders_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES users(tg_id) ON DELETE SET NULL;
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;
ALTER TABLE payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;
ALTER TABLE support_threads
    ADD CONSTRAINT support_threads_user_tg_id_fkey FOREIGN KEY (user_tg_id) REFERENCES users(tg_id) ON DELETE SET NULL;

-- Ensure additional columns exist and are populated.
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS idx integer;

WITH numbered AS (
    SELECT id, verification_id,
           ROW_NUMBER() OVER (PARTITION BY verification_id ORDER BY id) AS rn
    FROM verification_photos
)
UPDATE verification_photos vp
SET idx = numbered.rn
FROM numbered
WHERE vp.id = numbered.id
  AND (vp.idx IS NULL OR vp.idx <= 0);

DO $$
BEGIN
    ALTER TABLE verification_photos ALTER COLUMN idx SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'verification_photos_verification_idx_unique'
    ) THEN
        ALTER TABLE verification_photos
            ADD CONSTRAINT verification_photos_verification_idx_unique UNIQUE (verification_id, idx);
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_channel_posts'
          AND column_name = 'idx'
    ) THEN
        ALTER TABLE order_channel_posts
            DROP CONSTRAINT IF EXISTS order_channel_posts_order_idx_unique;
        ALTER TABLE order_channel_posts
            DROP COLUMN idx;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_channel_posts'
          AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE order_channel_posts DROP COLUMN updated_at;
    END IF;
END
$$;

WITH duplicates AS (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY order_id, channel_id ORDER BY id) AS rn
        FROM order_channel_posts
    ) ranked
    WHERE ranked.rn > 1
)
DELETE FROM order_channel_posts
WHERE id IN (SELECT id FROM duplicates);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_channel_posts_order_channel_unique'
    ) THEN
        ALTER TABLE order_channel_posts
            ADD CONSTRAINT order_channel_posts_order_channel_unique UNIQUE (order_id, channel_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_channel_posts_channel_message_unique'
    ) THEN
        ALTER TABLE order_channel_posts
            ADD CONSTRAINT order_channel_posts_channel_message_unique UNIQUE (channel_id, message_id);
    END IF;
END
$$;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE orders
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE orders
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    ALTER TABLE orders ALTER COLUMN updated_at SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS short_id text;

UPDATE orders
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

ALTER TABLE orders
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);

DO $$
BEGIN
    ALTER TABLE orders ALTER COLUMN short_id SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'orders_short_id_unique'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT orders_short_id_unique UNIQUE (short_id);
    END IF;
END
$$;

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS short_id text;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'days'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE subscriptions
            RENAME COLUMN days TO period_days;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE subscriptions
            ADD COLUMN period_days integer;
    END IF;
END
$$;

UPDATE subscriptions
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

UPDATE subscriptions
SET period_days = COALESCE(period_days, 0)
WHERE period_days IS NULL;

UPDATE subscriptions
SET period_days = GREATEST(interval_count, 0)
WHERE period_days = 0 AND interval_count IS NOT NULL;

ALTER TABLE subscriptions
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);
ALTER TABLE subscriptions
    ALTER COLUMN period_days SET DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN short_id SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN period_days SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

ALTER TABLE subscriptions DROP COLUMN IF EXISTS tier;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS interval;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS interval_count;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS cancel_at_period_end;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'subscriptions_short_id_unique'
    ) THEN
        ALTER TABLE subscriptions
            ADD CONSTRAINT subscriptions_short_id_unique UNIQUE (short_id);
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'subscriptions_user_chat_unique'
    ) THEN
        ALTER TABLE subscriptions
            ADD CONSTRAINT subscriptions_user_chat_unique UNIQUE (user_id, chat_id);
    END IF;
END
$$;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS short_id text;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'payment_provider'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN payment_provider TO provider;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'days'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN days TO period_days;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE payments
            ADD COLUMN period_days integer;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'file_id'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'receipt_file_id'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN file_id TO receipt_file_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'receipt_file_id'
    ) THEN
        ALTER TABLE payments
            ADD COLUMN receipt_file_id text;
    END IF;
END
$$;

ALTER TABLE payments DROP COLUMN IF EXISTS provider_customer_id;

UPDATE payments
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

ALTER TABLE payments
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);

DO $$
BEGIN
    ALTER TABLE payments ALTER COLUMN short_id SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_short_id_unique'
    ) THEN
        ALTER TABLE payments
            ADD CONSTRAINT payments_short_id_unique UNIQUE (short_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'callback_map'
          AND column_name = 'idx'
    ) THEN
        ALTER TABLE callback_map RENAME COLUMN idx TO id;
        IF EXISTS (
            SELECT 1 FROM pg_class WHERE relname = 'callback_map_idx_seq'
        ) THEN
            EXECUTE 'ALTER SEQUENCE callback_map_idx_seq RENAME TO callback_map_id_seq';
        END IF;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relname = 'callback_map_id_seq'
          AND relkind = 'S'
    ) THEN
        EXECUTE 'CREATE SEQUENCE callback_map_id_seq';
    END IF;
    EXECUTE 'ALTER SEQUENCE callback_map_id_seq OWNED BY callback_map.id';
    EXECUTE 'ALTER TABLE callback_map ALTER COLUMN id SET DEFAULT nextval(''callback_map_id_seq'')';
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'callback_map'::regclass
          AND contype = 'p'
    ) THEN
        ALTER TABLE callback_map DROP CONSTRAINT callback_map_pkey;
    END IF;
END
$$;

ALTER TABLE callback_map
    ADD CONSTRAINT callback_map_pkey PRIMARY KEY (id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'callback_map_token_unique'
    ) THEN
        ALTER TABLE callback_map
            ADD CONSTRAINT callback_map_token_unique UNIQUE (token);
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'support_threads'
          AND column_name = 'short_id'
    ) THEN
        ALTER TABLE support_threads
            DROP CONSTRAINT IF EXISTS support_threads_short_id_unique;
        ALTER TABLE support_threads
            DROP COLUMN short_id;
    END IF;
END
$$;

-- Ensure helper indexes are present.
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

-- Seed the singleton channels row.
INSERT INTO channels (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;
