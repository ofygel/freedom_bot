-- Idempotent patch ensuring the runtime schema matches the expected structure.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enum normalisation.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'user_role'::regtype
              AND enumlabel NOT IN ('client', 'courier', 'driver', 'moderator')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'user_role'::regtype
              AND enumlabel = 'client'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'user_role'::regtype
              AND enumlabel = 'courier'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'user_role'::regtype
              AND enumlabel = 'driver'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'user_role'::regtype
              AND enumlabel = 'moderator'
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'users'
                  AND column_name = 'role'
                  AND udt_name = 'user_role'
            ) THEN
                ALTER TABLE users
                    ALTER COLUMN role TYPE text USING role::text;
            END IF;

            DROP TYPE user_role;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS user_role AS ENUM ('client', 'courier', 'driver', 'moderator');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'role'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'users'
              AND column_name = 'role'
              AND udt_name <> 'user_role'
        ) THEN
            UPDATE users
            SET role = CASE
                WHEN role IS NULL THEN 'client'
                WHEN role::text IN ('client', 'courier', 'driver', 'moderator') THEN role::text
                WHEN role::text IN ('admin', 'administrator', 'support', 'moderator') THEN 'moderator'
                WHEN role::text IN ('executor', 'driver_role', 'driver') THEN 'driver'
                WHEN role::text IN ('courier', 'delivery') THEN 'courier'
                ELSE 'client'
            END;

            ALTER TABLE users
                ALTER COLUMN role TYPE user_role USING role::user_role;
        END IF;

        UPDATE users
        SET role = COALESCE(role, 'client'::user_role);

        ALTER TABLE users
            ALTER COLUMN role SET DEFAULT 'client';

        BEGIN
            ALTER TABLE users
                ALTER COLUMN role SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_kind') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_kind'::regtype
              AND enumlabel NOT IN ('taxi', 'delivery')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_kind'::regtype
              AND enumlabel = 'taxi'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_kind'::regtype
              AND enumlabel = 'delivery'
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'orders'
                  AND column_name = 'kind'
                  AND udt_name = 'order_kind'
            ) THEN
                ALTER TABLE orders
                    ALTER COLUMN kind TYPE text USING kind::text;
            END IF;

            DROP TYPE order_kind;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS order_kind AS ENUM ('taxi', 'delivery');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'kind'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'orders'
              AND column_name = 'kind'
              AND udt_name <> 'order_kind'
        ) THEN
            UPDATE orders
            SET kind = CASE
                WHEN kind IS NULL THEN 'taxi'
                WHEN kind::text IN ('taxi', 'ride', 'passenger', 'driver') THEN 'taxi'
                WHEN kind::text IN ('delivery', 'courier', 'parcel', 'cargo', 'express') THEN 'delivery'
                ELSE 'taxi'
            END;

            ALTER TABLE orders
                ALTER COLUMN kind TYPE order_kind USING kind::order_kind;
        END IF;

        UPDATE orders
        SET kind = COALESCE(kind, 'taxi'::order_kind);

        BEGIN
            ALTER TABLE orders
                ALTER COLUMN kind SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
              AND enumlabel NOT IN ('open', 'claimed', 'cancelled', 'done')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
              AND enumlabel = 'open'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
              AND enumlabel = 'claimed'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
              AND enumlabel = 'cancelled'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'order_status'::regtype
              AND enumlabel = 'done'
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'orders'
                  AND column_name = 'status'
                  AND udt_name = 'order_status'
            ) THEN
                ALTER TABLE orders
                    ALTER COLUMN status TYPE text USING status::text;
            END IF;

            DROP TYPE order_status;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS order_status AS ENUM ('open', 'claimed', 'cancelled', 'done');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'status'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'orders'
              AND column_name = 'status'
              AND udt_name <> 'order_status'
        ) THEN
            UPDATE orders
            SET status = CASE
                WHEN status IS NULL THEN 'open'
                WHEN status::text IN ('open', 'pending', 'new', 'created') THEN 'open'
                WHEN status::text IN ('claimed', 'accepted', 'assigned', 'in_progress', 'taken') THEN 'claimed'
                WHEN status::text IN ('cancelled', 'canceled', 'declined', 'rejected', 'void', 'voided') THEN 'cancelled'
                WHEN status::text IN ('done', 'completed', 'finished', 'closed') THEN 'done'
                ELSE 'open'
            END;

            ALTER TABLE orders
                ALTER COLUMN status TYPE order_status USING status::order_status;
        END IF;

        UPDATE orders
        SET status = COALESCE(status, 'open'::order_status);

        ALTER TABLE orders
            ALTER COLUMN status SET DEFAULT 'open';

        BEGIN
            ALTER TABLE orders
                ALTER COLUMN status SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_role') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_role'::regtype
              AND enumlabel NOT IN ('courier', 'driver')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_role'::regtype
              AND enumlabel = 'courier'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_role'::regtype
              AND enumlabel = 'driver'
        ) THEN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'verifications'
                  AND column_name = 'role'
                  AND udt_name = 'verification_role'
            ) THEN
                ALTER TABLE verifications
                    ALTER COLUMN role TYPE text USING role::text;
            END IF;

            DROP TYPE verification_role;
        END IF;
    END IF;
END
$$;

CREATE TYPE IF NOT EXISTS verification_role AS ENUM ('courier', 'driver');

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'verifications'
          AND column_name = 'role'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'verifications'
              AND column_name = 'role'
              AND udt_name <> 'verification_role'
        ) THEN
            UPDATE verifications
            SET role = CASE
                WHEN role IS NULL THEN 'courier'
                WHEN role::text IN ('driver', 'auto', 'car', 'taxi') THEN 'driver'
                WHEN role::text IN ('courier', 'delivery', 'bike', 'foot', 'walker') THEN 'courier'
                ELSE 'courier'
            END;

            ALTER TABLE verifications
                ALTER COLUMN role TYPE verification_role USING role::verification_role;
        END IF;

        UPDATE verifications
        SET role = COALESCE(role, 'courier'::verification_role);

        BEGIN
            ALTER TABLE verifications
                ALTER COLUMN role SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_status'::regtype
              AND enumlabel NOT IN ('pending', 'active', 'rejected', 'expired')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_status'::regtype
              AND enumlabel = 'pending'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_status'::regtype
              AND enumlabel = 'active'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_status'::regtype
              AND enumlabel = 'rejected'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'verification_status'::regtype
              AND enumlabel = 'expired'
        ) THEN
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
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'verifications'
              AND column_name = 'status'
              AND udt_name <> 'verification_status'
        ) THEN
            UPDATE verifications
            SET status = CASE
                WHEN status IS NULL THEN 'pending'
                WHEN status::text IN ('pending', 'collecting', 'submitted') THEN 'pending'
                WHEN status::text IN ('active', 'approved') THEN 'active'
                WHEN status::text IN ('rejected', 'declined', 'denied') THEN 'rejected'
                WHEN status::text IN ('expired', 'cancelled', 'canceled') THEN 'expired'
                ELSE 'pending'
            END;

            ALTER TABLE verifications
                ALTER COLUMN status TYPE verification_status USING status::verification_status;
        END IF;

        UPDATE verifications
        SET status = COALESCE(status, 'pending'::verification_status);

        ALTER TABLE verifications
            ALTER COLUMN status SET DEFAULT 'pending';

        BEGIN
            ALTER TABLE verifications
                ALTER COLUMN status SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'subscription_status'::regtype
              AND enumlabel NOT IN ('pending', 'active', 'rejected', 'expired')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'subscription_status'::regtype
              AND enumlabel = 'pending'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'subscription_status'::regtype
              AND enumlabel = 'active'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'subscription_status'::regtype
              AND enumlabel = 'rejected'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'subscription_status'::regtype
              AND enumlabel = 'expired'
        ) THEN
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
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'subscriptions'
              AND column_name = 'status'
              AND udt_name <> 'subscription_status'
        ) THEN
            UPDATE subscriptions
            SET status = CASE
                WHEN status IS NULL THEN 'pending'
                WHEN status::text IN ('pending', 'waiting', 'created', 'new') THEN 'pending'
                WHEN status::text IN ('active', 'trialing', 'past_due', 'paid', 'succeeded') THEN 'active'
                WHEN status::text IN ('rejected', 'failed', 'declined') THEN 'rejected'
                WHEN status::text IN ('expired', 'canceled', 'cancelled', 'ended', 'stopped', 'terminated', 'paused', 'on_hold') THEN 'expired'
                ELSE 'pending'
            END;

            ALTER TABLE subscriptions
                ALTER COLUMN status TYPE subscription_status USING status::subscription_status;
        END IF;

        UPDATE subscriptions
        SET status = COALESCE(status, 'pending'::subscription_status);

        ALTER TABLE subscriptions
            ALTER COLUMN status SET DEFAULT 'pending';

        BEGIN
            ALTER TABLE subscriptions
                ALTER COLUMN status SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
        IF EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel NOT IN ('pending', 'active', 'rejected', 'expired')
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel = 'pending'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel = 'active'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel = 'rejected'
        )
        OR NOT EXISTS (
            SELECT 1
            FROM pg_enum
            WHERE enumtypid = 'payment_status'::regtype
              AND enumlabel = 'expired'
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
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'payments'
              AND column_name = 'status'
              AND udt_name <> 'payment_status'
        ) THEN
            UPDATE payments
            SET status = CASE
                WHEN status IS NULL THEN 'pending'
                WHEN status::text IN ('pending', 'processing', 'created', 'new', 'waiting') THEN 'pending'
                WHEN status::text IN ('active', 'approved', 'succeeded', 'paid', 'completed', 'captured') THEN 'active'
                WHEN status::text IN ('rejected', 'failed', 'cancelled', 'canceled', 'expired', 'void', 'voided', 'refunded', 'chargeback') THEN 'rejected'
                ELSE 'pending'
            END;

            ALTER TABLE payments
                ALTER COLUMN status TYPE payment_status USING status::payment_status;
        END IF;

        UPDATE payments
        SET status = COALESCE(status, 'pending'::payment_status);

        ALTER TABLE payments
            ALTER COLUMN status SET DEFAULT 'pending';

        BEGIN
            ALTER TABLE payments
                ALTER COLUMN status SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
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
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS username text;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS first_name text;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS last_name text;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS phone text;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS role user_role;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS created_at timestamptz;
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS updated_at timestamptz;

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

        UPDATE users
        SET role = COALESCE(role, 'client'::user_role);
        ALTER TABLE users
            ALTER COLUMN role SET DEFAULT 'client';
        BEGIN
            ALTER TABLE users
                ALTER COLUMN role SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;

        UPDATE users
        SET created_at = COALESCE(created_at, now());
        ALTER TABLE users
            ALTER COLUMN created_at SET DEFAULT now();
        BEGIN
            ALTER TABLE users
                ALTER COLUMN created_at SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;

        UPDATE users
        SET updated_at = COALESCE(updated_at, now());
        ALTER TABLE users
            ALTER COLUMN updated_at SET DEFAULT now();
        BEGIN
            ALTER TABLE users
                ALTER COLUMN updated_at SET NOT NULL;
        EXCEPTION
            WHEN not_null_violation THEN
                NULL;
        END;
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

ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS role verification_role;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS status verification_status;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS photos_required integer;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS photos_uploaded integer;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE verifications DROP CONSTRAINT IF EXISTS verifications_user_id_fkey;
ALTER TABLE verifications
    ADD CONSTRAINT verifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;

UPDATE verifications
SET photos_required = COALESCE(photos_required, 0),
    photos_uploaded = COALESCE(photos_uploaded, 0);

ALTER TABLE verifications
    ALTER COLUMN photos_required SET DEFAULT 0;
ALTER TABLE verifications
    ALTER COLUMN photos_uploaded SET DEFAULT 0;

DO $$
BEGIN
    BEGIN
        ALTER TABLE verifications
            ALTER COLUMN photos_required SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE verifications
            ALTER COLUMN photos_uploaded SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

UPDATE verifications
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

ALTER TABLE verifications
    ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE verifications
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE verifications
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE verifications
            ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

CREATE TABLE IF NOT EXISTS verification_photos (
    id bigserial PRIMARY KEY,
    verification_id bigint NOT NULL REFERENCES verifications(id) ON DELETE CASCADE
);

ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS idx integer;
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS file_id text;
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS file_unique_id text;
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS file_size integer;
ALTER TABLE verification_photos
    ADD COLUMN IF NOT EXISTS created_at timestamptz;

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

UPDATE verification_photos
SET file_id = COALESCE(NULLIF(file_id, ''), 'missing');

DO $$
BEGIN
    BEGIN
        ALTER TABLE verification_photos
            ALTER COLUMN file_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

UPDATE verification_photos
SET created_at = COALESCE(created_at, now());

ALTER TABLE verification_photos
    ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE verification_photos
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
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
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS kind order_kind;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS status order_status;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS client_id bigint;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS client_phone text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_name text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_username text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS client_comment text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS claimed_by bigint;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS pickup_query text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS pickup_address text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS pickup_lat double precision;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS pickup_lon double precision;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS dropoff_query text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS dropoff_address text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS dropoff_lat double precision;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS dropoff_lon double precision;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS price_amount integer;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS price_currency text;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS distance_km double precision;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS channel_message_id bigint;
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS created_at timestamptz;

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

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_client_id_fkey;
ALTER TABLE orders
    ADD CONSTRAINT orders_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES users(tg_id) ON DELETE SET NULL;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_claimed_by_fkey;
ALTER TABLE orders
    ADD CONSTRAINT orders_claimed_by_fkey
    FOREIGN KEY (claimed_by) REFERENCES users(tg_id) ON DELETE SET NULL;

UPDATE orders
SET pickup_query = COALESCE(NULLIF(pickup_query, ''), 'N/A'),
    pickup_address = COALESCE(NULLIF(pickup_address, ''), 'N/A'),
    dropoff_query = COALESCE(NULLIF(dropoff_query, ''), 'N/A'),
    dropoff_address = COALESCE(NULLIF(dropoff_address, ''), 'N/A');

UPDATE orders
SET pickup_lat = COALESCE(pickup_lat, 0),
    pickup_lon = COALESCE(pickup_lon, 0),
    dropoff_lat = COALESCE(dropoff_lat, 0),
    dropoff_lon = COALESCE(dropoff_lon, 0),
    price_amount = COALESCE(price_amount, 0),
    distance_km = COALESCE(distance_km, 0),
    price_currency = COALESCE(NULLIF(price_currency, ''), 'KZT');

UPDATE orders
SET created_at = COALESCE(created_at, now());

ALTER TABLE orders
    ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

DO $$
BEGIN
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN pickup_query SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN pickup_address SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN dropoff_query SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN dropoff_address SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN pickup_lat SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN pickup_lon SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN dropoff_lat SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN dropoff_lon SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN price_amount SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN price_currency SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE orders
            ALTER COLUMN distance_km SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

CREATE TABLE IF NOT EXISTS order_channel_posts (
    id bigserial PRIMARY KEY,
    order_id bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE
);

ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS idx integer;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS channel_id bigint;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS message_id bigint;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS thread_id bigint;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE order_channel_posts
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE order_channel_posts
SET updated_at = COALESCE(updated_at, published_at, now())
WHERE updated_at IS NULL;

UPDATE order_channel_posts
SET published_at = COALESCE(published_at, now());

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

UPDATE order_channel_posts
SET channel_id = COALESCE(channel_id, 0),
    message_id = COALESCE(message_id, 0);

ALTER TABLE order_channel_posts
    ALTER COLUMN published_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE order_channel_posts
            ALTER COLUMN channel_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE order_channel_posts
            ALTER COLUMN message_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE order_channel_posts
            ALTER COLUMN published_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE order_channel_posts
            ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
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
    ADD COLUMN IF NOT EXISTS short_id text;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS user_id bigint;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS chat_id bigint;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS plan text;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS status subscription_status;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS amount integer;
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

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS next_billing_at timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS grace_until timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS last_warning_at timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'subscriptions'
          AND column_name = 'metadata'
          AND udt_name <> 'jsonb'
    ) THEN
        ALTER TABLE subscriptions
            ALTER COLUMN metadata TYPE jsonb USING
                CASE
                    WHEN metadata IS NULL THEN '{}'::jsonb
                    ELSE metadata::jsonb
                END;
    END IF;
END
$$;

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
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

ALTER TABLE subscriptions
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);

DO $$
BEGIN
    ALTER TABLE subscriptions ALTER COLUMN short_id SET NOT NULL;
EXCEPTION
    WHEN not_null_violation THEN
        NULL;
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

UPDATE subscriptions
SET plan = COALESCE(NULLIF(plan, ''), 'manual');

UPDATE subscriptions
SET currency = COALESCE(NULLIF(currency, ''), 'KZT');

UPDATE subscriptions
SET amount = COALESCE(amount, 0);

UPDATE subscriptions
SET metadata =
    CASE
        WHEN metadata IS NULL THEN '{}'::jsonb
        ELSE metadata
    END;

ALTER TABLE subscriptions
    ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

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

UPDATE subscriptions
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

ALTER TABLE subscriptions
    ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE subscriptions
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN user_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN chat_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN plan SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN status SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN currency SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN amount SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN metadata SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE subscriptions
            ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

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
    ADD COLUMN IF NOT EXISTS subscription_id bigint;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS user_id bigint;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS amount integer;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS status payment_status;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payment_provider text;
ALTER TABLE payments
    ALTER COLUMN payment_provider SET DEFAULT 'manual';

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_payment_id text;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS provider_customer_id text;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS invoice_url text;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS receipt_url text;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS period_start timestamptz;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS period_end timestamptz;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS created_at timestamptz;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'payments'
          AND column_name = 'metadata'
          AND udt_name <> 'jsonb'
    ) THEN
        ALTER TABLE payments
            ALTER COLUMN metadata TYPE jsonb USING
                CASE
                    WHEN metadata IS NULL THEN '{}'::jsonb
                    ELSE metadata::jsonb
                END;
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
          AND column_name = 'period_days'
    ) THEN
        ALTER TABLE payments
            RENAME COLUMN period_days TO days;
    END IF;
END
$$;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS days integer;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_subscription_id_fkey;
ALTER TABLE payments
    ADD CONSTRAINT payments_subscription_id_fkey
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE payments
    ADD CONSTRAINT payments_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(tg_id) ON DELETE CASCADE;

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
SET payment_provider = COALESCE(NULLIF(payment_provider, ''), 'manual');

ALTER TABLE payments
    ALTER COLUMN payment_provider DROP DEFAULT;

UPDATE payments
SET amount = COALESCE(amount, 0),
    currency = COALESCE(NULLIF(currency, ''), 'KZT');

UPDATE payments
SET metadata =
    CASE
        WHEN metadata IS NULL THEN '{}'::jsonb
        ELSE metadata
    END;

ALTER TABLE payments
    ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

UPDATE payments
SET created_at = COALESCE(created_at, now());

ALTER TABLE payments
    ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN subscription_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN user_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN amount SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN currency SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN status SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN payment_provider SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN metadata SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE payments
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

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
-- Session storage alignment.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    scope text NOT NULL,
    scope_id bigint NOT NULL,
    state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, scope_id)
);

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS scope_id bigint;
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS state jsonb;
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'state'
          AND udt_name <> 'jsonb'
    ) THEN
        ALTER TABLE sessions
            ALTER COLUMN state TYPE jsonb USING
                CASE
                    WHEN state IS NULL THEN '{}'::jsonb
                    ELSE state::jsonb
                END;
    END IF;
END
$$;

UPDATE sessions
SET created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

ALTER TABLE sessions
    ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE sessions
    ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pkey;
ALTER TABLE sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (scope, scope_id);

DO $$
BEGIN
    BEGIN
        ALTER TABLE sessions
            ALTER COLUMN scope SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE sessions
            ALTER COLUMN scope_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE sessions
            ALTER COLUMN state SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE sessions
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE sessions
            ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

-- ---------------------------------------------------------------------------
-- Callback map storage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS callback_map (
    idx bigserial PRIMARY KEY,
    token text NOT NULL UNIQUE
);

ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS chat_id bigint;
ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS message_id bigint;
ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS payload jsonb;
ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE callback_map
    ADD COLUMN IF NOT EXISTS created_at timestamptz;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'callback_map'
          AND column_name = 'payload'
          AND udt_name <> 'jsonb'
    ) THEN
        ALTER TABLE callback_map
            ALTER COLUMN payload TYPE jsonb USING
                CASE
                    WHEN payload IS NULL THEN '{}'::jsonb
                    ELSE payload::jsonb
                END;
    END IF;
END
$$;

UPDATE callback_map
SET action = COALESCE(NULLIF(action, ''), 'noop'),
    payload = COALESCE(payload, '{}'::jsonb),
    expires_at = COALESCE(expires_at, now()),
    created_at = COALESCE(created_at, now());

ALTER TABLE callback_map
    ALTER COLUMN payload SET DEFAULT '{}'::jsonb;
ALTER TABLE callback_map
    ALTER COLUMN created_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE callback_map
            ALTER COLUMN action SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE callback_map
            ALTER COLUMN payload SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE callback_map
            ALTER COLUMN expires_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE callback_map
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

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
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS user_chat_id bigint;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS user_tg_id bigint;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS user_message_id bigint;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS moderator_chat_id bigint;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS moderator_message_id bigint;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE support_threads
    ADD COLUMN IF NOT EXISTS updated_at timestamptz;

ALTER TABLE support_threads DROP CONSTRAINT IF EXISTS support_threads_user_tg_id_fkey;
ALTER TABLE support_threads
    ADD CONSTRAINT support_threads_user_tg_id_fkey
    FOREIGN KEY (user_tg_id) REFERENCES users(tg_id);

UPDATE support_threads
SET short_id = substr(gen_random_uuid()::text, 1, 8)
WHERE short_id IS NULL OR length(trim(short_id)) = 0;

ALTER TABLE support_threads
    ALTER COLUMN short_id SET DEFAULT substr(gen_random_uuid()::text, 1, 8);

UPDATE support_threads
SET status = CASE
        WHEN status IN ('closed', 'resolved', 'done', 'archived') THEN 'closed'
        ELSE 'open'
    END,
    created_at = COALESCE(created_at, now()),
    updated_at = COALESCE(updated_at, now());

ALTER TABLE support_threads
    ALTER COLUMN status SET DEFAULT 'open';
ALTER TABLE support_threads
    ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE support_threads
    ALTER COLUMN updated_at SET DEFAULT now();

DO $$
BEGIN
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN user_chat_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN user_message_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN moderator_chat_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN moderator_message_id SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN status SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN created_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
    BEGIN
        ALTER TABLE support_threads
            ALTER COLUMN updated_at SET NOT NULL;
    EXCEPTION
        WHEN not_null_violation THEN
            NULL;
    END;
END
$$;

ALTER TABLE support_threads DROP CONSTRAINT IF EXISTS support_threads_status_check;
ALTER TABLE support_threads
    ADD CONSTRAINT support_threads_status_check CHECK (status IN ('open', 'closed'));

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
-- NOTE: idx_subscriptions_user_status is maintained alongside
-- 002_subscriptions_user_status_index.sql to prevent duplicate migrations.
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_status ON subscriptions(user_id, status);
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
