-- Base schema for the Freedom Bot database.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id bigint NOT NULL,
    username text,
    first_name text,
    last_name text,
    phone text,
    role text NOT NULL DEFAULT 'customer',
    status text NOT NULL DEFAULT 'active',
    city text NOT NULL DEFAULT 'almaty',
    language_code text DEFAULT 'ru',
    is_blocked boolean NOT NULL DEFAULT false,
    is_courier boolean NOT NULL DEFAULT false,
    courier_rating numeric(4, 2) DEFAULT 0,
    referral_code text UNIQUE,
    referred_by uuid REFERENCES users(id),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_active_at timestamptz,
    UNIQUE (telegram_id)
);

CREATE TABLE IF NOT EXISTS verifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending',
    type text NOT NULL DEFAULT 'courier',
    city text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    rejection_reason text,
    reviewed_by uuid REFERENCES users(id),
    reviewed_at timestamptz,
    verified_at timestamptz,
    expires_at timestamptz,
    channel_id bigint,
    message_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_documents (
    id bigserial PRIMARY KEY,
    verification_id uuid NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
    file_id text NOT NULL,
    file_type text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_messages (
    id bigserial PRIMARY KEY,
    verification_id uuid NOT NULL REFERENCES verifications(id) ON DELETE CASCADE,
    author_id uuid REFERENCES users(id),
    author_role text NOT NULL,
    message text NOT NULL,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id bigint NOT NULL,
    plan text NOT NULL,
    tier text,
    status text NOT NULL DEFAULT 'active',
    currency text NOT NULL DEFAULT 'KZT',
    amount integer NOT NULL,
    interval text NOT NULL DEFAULT 'month',
    interval_count integer NOT NULL DEFAULT 1,
    next_billing_at timestamptz,
    grace_until timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    cancelled_at timestamptz,
    ended_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, chat_id)
);

CREATE TABLE IF NOT EXISTS subscription_payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    amount integer NOT NULL,
    currency text NOT NULL DEFAULT 'KZT',
    status text NOT NULL,
    payment_provider text,
    provider_payment_id text,
    provider_customer_id text,
    invoice_url text,
    period_start timestamptz,
    period_end timestamptz,
    paid_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider_payment_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    courier_id uuid REFERENCES users(id) ON DELETE SET NULL,
    subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
    verification_id uuid REFERENCES verifications(id) ON DELETE SET NULL,
    status text NOT NULL DEFAULT 'draft',
    type text NOT NULL DEFAULT 'delivery',
    city text NOT NULL,
    channel_id bigint,
    message_id bigint,
    pickup_address text NOT NULL,
    pickup_latitude numeric(9, 6),
    pickup_longitude numeric(9, 6),
    pickup_comment text,
    pickup_floor text,
    pickup_entrance text,
    pickup_apartment text,
    dropoff_address text NOT NULL,
    dropoff_latitude numeric(9, 6),
    dropoff_longitude numeric(9, 6),
    dropoff_comment text,
    dropoff_floor text,
    dropoff_entrance text,
    dropoff_apartment text,
    recipient_name text,
    recipient_phone text,
    contactless boolean NOT NULL DEFAULT false,
    need_change integer,
    needs_thermobox boolean NOT NULL DEFAULT false,
    weight_kg numeric(6, 2),
    distance_meters integer,
    duration_minutes integer,
    cost_estimated integer,
    cost_final integer,
    courier_fee integer,
    courier_payout integer,
    currency text NOT NULL DEFAULT 'KZT',
    pricing jsonb NOT NULL DEFAULT '{}'::jsonb,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    comment text,
    internal_comment text,
    published_at timestamptz,
    accepted_at timestamptz,
    assigned_at timestamptz,
    picked_up_at timestamptz,
    delivered_at timestamptz,
    cancelled_at timestamptz,
    cancellation_reason text,
    failure_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_assignments (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES users(id),
    status text NOT NULL DEFAULT 'pending',
    comment text,
    created_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    declined_at timestamptz,
    decline_reason text
);

CREATE TABLE IF NOT EXISTS order_status_history (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status text NOT NULL,
    previous_status text,
    changed_by uuid REFERENCES users(id),
    comment text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_messages (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    author_id uuid REFERENCES users(id),
    author_role text NOT NULL,
    recipient_id uuid REFERENCES users(id),
    message text NOT NULL,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_broadcasts (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    channel_id bigint NOT NULL,
    message_id bigint,
    delivered boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_settings (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    notifications_enabled boolean NOT NULL DEFAULT true,
    accepts_cash boolean NOT NULL DEFAULT true,
    accepts_card boolean NOT NULL DEFAULT false,
    preferred_language text,
    preferred_city text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_verifications_user ON verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_city_status ON orders(city, status);
CREATE INDEX IF NOT EXISTS idx_order_assignments_order ON order_assignments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_order_messages_order ON order_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_subscription ON subscription_payments(subscription_id);
