-- Idempotent patch ensuring the runtime schema matches the expected structure.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enum normalisation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        PERFORM 1
        FROM pg_enum
        WHERE enumtypid = 'verification_status'::regtype
          AND enumlabel = 'expired';

        IF NOT FOUND THEN
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
            SET status = CASE
                WHEN status = 'approved' THEN 'active'
                WHEN status IN ('cancelled', 'canceled') THEN 'expired'
                WHEN status NOT IN ('pending', 'active', 'rejected', 'expired') OR status IS NULL THEN 'pending'
                ELSE status
            END;

            DROP TYPE verification_status;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS verification_status AS ENUM ('pending', 'active', 'rejected', 'expired');

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
        PERFORM 1
        FROM pg_enum
        WHERE enumtypid = 'subscription_status'::regtype
          AND enumlabel = 'paused';

        IF FOUND THEN
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

            UPDATE subscriptions
            SET status = CASE
                WHEN status IN ('trialing', 'past_due', 'active') THEN 'active'
                WHEN status IN ('canceled', 'cancelled', 'expired') THEN 'expired'
                WHEN status NOT IN ('pending', 'active', 'rejected', 'expired') OR status IS NULL THEN 'pending'
                ELSE status
            END;

            DROP TYPE subscription_status;
        END IF;
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
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        PERFORM 1
        FROM pg_enum
        WHERE enumtypid = 'payment_status'::regtype
          AND enumlabel = 'approved';

        IF FOUND OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel = 'active'
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'payments'
                  AND column_name = 'status'
                  AND udt_name = 'payment_status'
            ) THEN
                ALTER TABLE payments
                    ALTER COLUMN status TYPE text USING status::text;
            END IF;

            UPDATE payments
            SET status = CASE
                WHEN status IN ('approved', 'succeeded', 'active') THEN 'active'
                WHEN status IN ('failed', 'rejected', 'cancelled', 'canceled', 'expired') THEN 'rejected'
                WHEN status NOT IN ('pending', 'active', 'rejected', 'expired') OR status IS NULL THEN 'pending'
                ELSE status
            END;

            DROP TYPE payment_status;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS payment_status AS ENUM ('pending', 'active', 'rejected', 'expired');

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

-- ---------------------------------------------------------------------------
-- Users table adjustments.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id          bigserial PRIMARY KEY,
    tg_id       bigint      NOT NULL,
    username    text,
    first_name  text,
    last_name   text,
    phone       text,
    role        user_role   NOT NULL DEFAULT 'client',
    is_verified boolean     NOT NULL DEFAULT false,
    marketing_opt_in boolean NOT NULL DEFAULT false,
    is_blocked  boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
    seq_name text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'users'
    ) THEN
        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'id'
        ) THEN
            ALTER TABLE users ADD COLUMN id bigint;
        END IF;

        SELECT pg_get_serial_sequence('users', 'id') INTO seq_name;
        IF seq_name IS NULL THEN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_class
                WHERE relname = 'users_id_seq'
                  AND relkind = 'S'
            ) THEN
                EXECUTE 'CREATE SEQUENCE users_id_seq';
            END IF;
            EXECUTE 'ALTER SEQUENCE users_id_seq OWNED BY users.id';
            EXECUTE 'ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval(''users_id_seq'')';
            seq_name := 'users_id_seq';
        ELSE
            EXECUTE format('ALTER SEQUENCE %s OWNED BY users.id', seq_name);
            EXECUTE format('ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval(''%s'')', seq_name);
        END IF;

        UPDATE users
        SET id = nextval(seq_name)
        WHERE id IS NULL;

        EXECUTE format(
            'SELECT setval(''%s'', COALESCE(MAX(id), 0), true) FROM users',
            seq_name
        );

        BEGIN
            ALTER TABLE users ALTER COLUMN id SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;

        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_pkey;
        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);

        ALTER TABLE users
            ALTER COLUMN tg_id SET NOT NULL;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = 'users'::regclass
              AND conname = 'users_tg_id_unique'
        ) THEN
            ALTER TABLE users
                ADD CONSTRAINT users_tg_id_unique UNIQUE (tg_id);
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

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'is_verified'
        ) THEN
            ALTER TABLE users
                ADD COLUMN is_verified boolean NOT NULL DEFAULT false;
        ELSE
            ALTER TABLE users
                ALTER COLUMN is_verified SET DEFAULT false;
            UPDATE users
            SET is_verified = COALESCE(is_verified, false)
            WHERE is_verified IS NULL;
            ALTER TABLE users
                ALTER COLUMN is_verified SET NOT NULL;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'marketing_opt_in'
        ) THEN
            ALTER TABLE users
                ADD COLUMN marketing_opt_in boolean NOT NULL DEFAULT false;
        ELSE
            ALTER TABLE users
                ALTER COLUMN marketing_opt_in SET DEFAULT false;
            UPDATE users
            SET marketing_opt_in = COALESCE(marketing_opt_in, false)
            WHERE marketing_opt_in IS NULL;
            ALTER TABLE users
                ALTER COLUMN marketing_opt_in SET NOT NULL;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'is_blocked'
        ) THEN
            ALTER TABLE users
                ADD COLUMN is_blocked boolean NOT NULL DEFAULT false;
        ELSE
            ALTER TABLE users
                ALTER COLUMN is_blocked SET DEFAULT false;
            UPDATE users
            SET is_blocked = COALESCE(is_blocked, false)
            WHERE is_blocked IS NULL;
            ALTER TABLE users
                ALTER COLUMN is_blocked SET NOT NULL;
        END IF;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Channels singleton table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
    id integer PRIMARY KEY,
    verify_channel_id bigint,
    drivers_channel_id bigint
);

DO $$
DECLARE
    seq_name text;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'channels'
          AND column_name = 'id'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'channels'
              AND column_name = 'id'
              AND data_type = 'boolean'
        ) THEN
            ALTER TABLE channels
                ALTER COLUMN id DROP DEFAULT;
            ALTER TABLE channels
                ALTER COLUMN id TYPE integer USING CASE WHEN id THEN 1 ELSE 0 END;
        END IF;

        SELECT pg_get_serial_sequence('channels', 'id') INTO seq_name;
        IF seq_name IS NULL THEN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_class
                WHERE relname = 'channels_id_seq'
                  AND relkind = 'S'
            ) THEN
                EXECUTE 'CREATE SEQUENCE channels_id_seq';
            END IF;
            EXECUTE 'ALTER SEQUENCE channels_id_seq OWNED BY channels.id';
            EXECUTE 'ALTER TABLE channels ALTER COLUMN id SET DEFAULT nextval(''channels_id_seq'')';
            seq_name := 'channels_id_seq';
        ELSE
            EXECUTE format('ALTER SEQUENCE %s OWNED BY channels.id', seq_name);
            EXECUTE format('ALTER TABLE channels ALTER COLUMN id SET DEFAULT nextval(''%s'')', seq_name);
        END IF;

        UPDATE channels
        SET id = 1
        WHERE id IS DISTINCT FROM 1;

        EXECUTE format('SELECT setval(''%s'', 1, true)', seq_name);
    END IF;
END
$$;

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_pkey;
ALTER TABLE channels ADD CONSTRAINT channels_pkey PRIMARY KEY (id);
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_singleton;
ALTER TABLE channels ADD CONSTRAINT channels_singleton CHECK (id = 1);

-- ---------------------------------------------------------------------------
-- Verification photos indexing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verifications (
    id bigserial PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification_photos (
    id bigserial PRIMARY KEY,
    verification_id bigint NOT NULL REFERENCES verifications(id) ON DELETE CASCADE
);

ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS idx integer;

WITH numbered AS (
    SELECT id,
           verification_id,
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

-- ---------------------------------------------------------------------------
-- Orders and channel posts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id bigserial PRIMARY KEY,
    short_id text NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8)
);

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

ALTER TABLE orders DROP COLUMN IF EXISTS updated_at;

CREATE TABLE IF NOT EXISTS order_channel_posts (
    id bigserial PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS idx integer;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE order_channel_posts
SET updated_at = COALESCE(updated_at, published_at, now())
WHERE updated_at IS NULL;

WITH ranked AS (
    SELECT id,
           order_id,
           ROW_NUMBER() OVER (PARTITION BY order_id ORDER BY id) AS rn
    FROM order_channel_posts
)
UPDATE order_channel_posts ocp
SET idx = ranked.rn
FROM ranked
WHERE ocp.id = ranked.id
  AND (ocp.idx IS NULL OR ocp.idx <= 0);

DO $$
BEGIN
    ALTER TABLE order_channel_posts ALTER COLUMN idx SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE order_channel_posts ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION
    WHEN datatype_mismatch THEN
        NULL;
END
$$;

WITH order_duplicates AS (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY order_id, channel_id ORDER BY id) AS rn
        FROM order_channel_posts
    ) ranked
    WHERE ranked.rn > 1
),
channel_duplicates AS (
    SELECT id
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY channel_id, message_id ORDER BY id) AS rn
        FROM order_channel_posts
    ) ranked
    WHERE ranked.rn > 1
)
DELETE FROM order_channel_posts
WHERE id IN (SELECT id FROM order_duplicates UNION SELECT id FROM channel_duplicates);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'order_channel_posts_order_idx_unique'
    ) THEN
        ALTER TABLE order_channel_posts
            ADD CONSTRAINT order_channel_posts_order_idx_unique UNIQUE (order_id, idx);
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

-- ---------------------------------------------------------------------------
-- Subscriptions table alignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id bigserial PRIMARY KEY,
    short_id text NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8)
);

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS tier text;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS interval text;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS interval_count integer;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS days integer;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE subscriptions
            RENAME COLUMN period_days TO days;
    END IF;
END
$$;

UPDATE subscriptions
SET interval = COALESCE(NULLIF(trim(interval), ''), 'day')
WHERE interval IS NULL OR trim(interval) = '';

UPDATE subscriptions
SET interval_count = COALESCE(interval_count, 1)
WHERE interval_count IS NULL OR interval_count <= 0;

UPDATE subscriptions
SET days = COALESCE(days, interval_count, 0)
WHERE days IS NULL;

ALTER TABLE subscriptions
    ALTER COLUMN interval SET DEFAULT 'day';
ALTER TABLE subscriptions
    ALTER COLUMN interval SET NOT NULL;
ALTER TABLE subscriptions
    ALTER COLUMN interval_count SET DEFAULT 1;

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN interval_count SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

ALTER TABLE subscriptions
    ALTER COLUMN days SET DEFAULT 0;

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN days SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

ALTER TABLE subscriptions
    ALTER COLUMN cancel_at_period_end SET DEFAULT false;

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN cancel_at_period_end SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
END
$$;

UPDATE subscriptions
SET cancel_at_period_end = COALESCE(cancel_at_period_end, false)
WHERE cancel_at_period_end IS NULL;

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

-- ---------------------------------------------------------------------------
-- Payments table alignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id bigserial PRIMARY KEY,
    short_id text NOT NULL DEFAULT substr(gen_random_uuid()::text, 1, 8)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'provider'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN provider TO payment_provider;
    END IF;
END
$$;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE payments
    ALTER COLUMN payment_provider SET DEFAULT 'manual';

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_customer_id text;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN period_days TO days;
    END IF;
END
$$;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS days integer;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'receipt_file_id'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN receipt_file_id TO file_id;
    END IF;
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'file_id'
          AND data_type <> 'text'
    ) THEN
        ALTER TABLE payments
            ALTER COLUMN file_id TYPE text;
    END IF;
END
$$;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS file_id text;

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
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payments_provider_payment_unique'
    ) THEN
        ALTER TABLE payments
            ADD CONSTRAINT payments_provider_payment_unique UNIQUE (provider_payment_id);
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Callback map storage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS callback_map (
    idx bigserial PRIMARY KEY,
    token text NOT NULL UNIQUE
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'callback_map'
          AND column_name = 'id'
    ) THEN
        ALTER TABLE callback_map RENAME COLUMN id TO idx;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relname = 'callback_map_idx_seq'
          AND relkind = 'S'
    ) THEN
        EXECUTE 'CREATE SEQUENCE callback_map_idx_seq';
    END IF;
    EXECUTE 'ALTER SEQUENCE callback_map_idx_seq OWNED BY callback_map.idx';
    EXECUTE 'ALTER TABLE callback_map ALTER COLUMN idx SET DEFAULT nextval(''callback_map_idx_seq'')';
END
$$;

ALTER TABLE callback_map DROP CONSTRAINT IF EXISTS callback_map_pkey;
ALTER TABLE callback_map ADD CONSTRAINT callback_map_pkey PRIMARY KEY (idx);

-- ---------------------------------------------------------------------------
-- Support threads short identifiers.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_threads (
    id text PRIMARY KEY
);

ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS short_id text;

UPDATE support_threads
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

ALTER TABLE support_threads
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);

DO $$
BEGIN
    ALTER TABLE support_threads ALTER COLUMN short_id SET NOT NULL;
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
        WHERE conname = 'support_threads_short_id_unique'
    ) THEN
        ALTER TABLE support_threads
            ADD CONSTRAINT support_threads_short_id_unique UNIQUE (short_id);
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Helper indexes.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Seed the singleton channels row.
-- ---------------------------------------------------------------------------
INSERT INTO channels (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
