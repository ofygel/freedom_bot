-- Follow-up adjustments migrating the legacy schema to the current layout.
DO $$
DECLARE
    needs_migration boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'is_courier'
    )
    INTO needs_migration;

    IF NOT needs_migration THEN
        RAISE NOTICE 'Skipping legacy schema migration; users.is_courier column not found.';
        RETURN;
    END IF;

    -- Prepare enum types and column conversions.
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'user_role'
    ) THEN
        EXECUTE $$CREATE TYPE user_role AS ENUM ('client', 'executor', 'moderator')$$;
    END IF;

    EXECUTE 'ALTER TYPE order_status RENAME TO order_status_old';
    EXECUTE $$CREATE TYPE order_status AS ENUM ('open', 'claimed', 'cancelled', 'done')$$;

    EXECUTE $$
        ALTER TABLE orders
            ALTER COLUMN status DROP DEFAULT
    $$;

    EXECUTE $$
        ALTER TABLE orders
            ALTER COLUMN status TYPE order_status
            USING CASE
                WHEN status::text = 'new' THEN 'open'::order_status
                WHEN status::text = 'claimed' THEN 'claimed'::order_status
                WHEN status::text = 'cancelled' THEN 'cancelled'::order_status
                ELSE 'open'::order_status
            END
    $$;

    EXECUTE $$ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'open'::order_status$$;
    EXECUTE 'DROP TYPE order_status_old';

    -- Rename verification enum to the new name used by the runtime.
    EXECUTE 'ALTER TYPE verification_type RENAME TO verification_role';

    -- Extend orders with the new bookkeeping columns.
    EXECUTE $$
        ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS customer_name text,
            ADD COLUMN IF NOT EXISTS customer_username text,
            ADD COLUMN IF NOT EXISTS client_comment text,
            ADD COLUMN IF NOT EXISTS claimed_by bigint,
            ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
            ADD COLUMN IF NOT EXISTS completed_at timestamptz
    $$;

    EXECUTE $$
        UPDATE orders
        SET
            customer_name = COALESCE(customer_name, metadata->>'customerName'),
            customer_username = COALESCE(customer_username, metadata->>'customerUsername'),
            client_comment = COALESCE(client_comment, metadata->>'notes')
    $$;

    EXECUTE $$
        ALTER TABLE orders
            DROP COLUMN IF EXISTS metadata
    $$;

    -- Ensure helper indexes exist for the extended order state.
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_orders_claimed_by ON orders(claimed_by)$$;

    -- Create new user records with numeric identifiers and role/is_verified flags.
    EXECUTE $$
        CREATE TABLE users_new (
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
            updated_at timestamptz NOT NULL DEFAULT now(),
            old_id uuid
        )
    $$;

    EXECUTE $$
        INSERT INTO users_new (
            telegram_id,
            username,
            first_name,
            last_name,
            phone,
            role,
            marketing_opt_in,
            is_blocked,
            created_at,
            updated_at,
            old_id
        )
        SELECT
            telegram_id,
            username,
            first_name,
            last_name,
            phone,
            CASE WHEN is_courier THEN 'executor' ELSE 'client' END,
            marketing_opt_in,
            is_blocked,
            created_at,
            updated_at,
            id
        FROM users
    $$;

    EXECUTE $$
        CREATE TEMP TABLE user_id_map ON COMMIT DROP AS
        SELECT old_id, id AS new_id
        FROM users_new
    $$;

    -- Rebuild verifications with explicit photo counters and numeric user references.
    EXECUTE $$
        CREATE TABLE verifications_new (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
            role verification_role NOT NULL,
            status verification_status NOT NULL DEFAULT 'pending',
            photos_required integer NOT NULL DEFAULT 0,
            photos_uploaded integer NOT NULL DEFAULT 0,
            expires_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    $$;

    EXECUTE $$
        INSERT INTO verifications_new (
            user_id,
            role,
            status,
            photos_required,
            photos_uploaded,
            expires_at,
            created_at,
            updated_at
        )
        SELECT
            map.new_id,
            v.type::text::verification_role,
            v.status,
            0,
            0,
            v.expires_at,
            v.created_at,
            v.updated_at
        FROM verifications v
        JOIN user_id_map map ON map.old_id = v.user_id
    $$;

    -- Build the subscriptions table with numeric identifiers and the new warning bookkeeping.
    EXECUTE $$
        CREATE TABLE subscriptions_new (
            id bigserial PRIMARY KEY,
            user_id bigint NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
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
            old_id uuid,
            UNIQUE (user_id, chat_id)
        )
    $$;

    EXECUTE $$
        INSERT INTO subscriptions_new (
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
            metadata,
            created_at,
            updated_at,
            old_id
        )
        SELECT
            map.new_id,
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
            COALESCE(metadata, '{}'::jsonb),
            created_at,
            updated_at,
            id
        FROM subscriptions s
        JOIN user_id_map map ON map.old_id = s.user_id
    $$;

    EXECUTE $$
        CREATE TEMP TABLE subscription_id_map ON COMMIT DROP AS
        SELECT old_id, id AS new_id, user_id
        FROM subscriptions_new
    $$;

    -- Create the consolidated payments table and backfill existing subscription payments.
    EXECUTE $$
        CREATE TABLE payments (
            id bigserial PRIMARY KEY,
            subscription_id bigint NOT NULL REFERENCES subscriptions_new(id) ON DELETE CASCADE,
            user_id bigint NOT NULL REFERENCES users_new(id) ON DELETE CASCADE,
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
        )
    $$;

    EXECUTE $$
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
            metadata,
            created_at
        )
        SELECT
            sub_map.new_id,
            sub_map.user_id,
            sp.amount,
            sp.currency,
            sp.status,
            sp.payment_provider,
            sp.provider_payment_id,
            sp.provider_customer_id,
            sp.invoice_url,
            sp.receipt_url,
            sp.period_start,
            sp.period_end,
            sp.paid_at,
            COALESCE(sp.metadata, '{}'::jsonb),
            sp.created_at
        FROM subscription_payments sp
        JOIN subscription_id_map sub_map ON sub_map.old_id = sp.subscription_id
    $$;

    -- Sync is_verified flags with active verifications.
    EXECUTE $$
        UPDATE users_new u
        SET is_verified = true
        WHERE EXISTS (
            SELECT 1
            FROM verifications_new v
            WHERE v.user_id = u.id
              AND v.status = 'approved'
              AND (v.expires_at IS NULL OR v.expires_at > now())
        )
    $$;

    -- Retire legacy tables now that data has been migrated.
    EXECUTE 'DROP TABLE IF EXISTS subscription_payments';
    EXECUTE 'DROP TABLE IF EXISTS subscription_events';
    EXECUTE 'DROP TABLE verifications';
    EXECUTE 'DROP TABLE subscriptions';
    EXECUTE 'DROP TABLE users';

    EXECUTE 'ALTER TABLE users_new DROP COLUMN old_id';
    EXECUTE 'ALTER TABLE subscriptions_new DROP COLUMN old_id';

    EXECUTE 'ALTER TABLE verifications_new RENAME TO verifications';
    EXECUTE 'ALTER TABLE subscriptions_new RENAME TO subscriptions';
    EXECUTE 'ALTER TABLE users_new RENAME TO users';

    -- Final index and constraint tidy-up.
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)$$;
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_verifications_user_role_status ON verifications(user_id, role, status)$$;
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)$$;
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_subscriptions_chat_id ON subscriptions(chat_id)$$;
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id)$$;
    EXECUTE $$CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)$$;
END
$$;
