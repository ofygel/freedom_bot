-- Follow-up adjustments and additional supporting tables.
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS timezone text,
    ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_rating integer CHECK (customer_rating BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS courier_rating integer CHECK (courier_rating BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS rated_at timestamptz;

CREATE TABLE IF NOT EXISTS order_feedback (
    id bigserial PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating integer CHECK (rating BETWEEN 1 AND 5),
    comment text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_order_feedback_unique ON order_feedback(order_id, author_id);

CREATE TABLE IF NOT EXISTS subscription_events (
    id bigserial PRIMARY KEY,
    subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription ON subscription_events(subscription_id);

ALTER TABLE subscription_payments
    ADD COLUMN IF NOT EXISTS receipt_url text,
    ADD COLUMN IF NOT EXISTS failure_reason text;

ALTER TABLE verifications
    ADD COLUMN IF NOT EXISTS notes text,
    ADD COLUMN IF NOT EXISTS reviewer_comment text;

DO $$
BEGIN
    ALTER TABLE verifications
        ADD CONSTRAINT verifications_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE orders
        ADD CONSTRAINT orders_status_check CHECK (status IN (
            'draft',
            'pending',
            'published',
            'assigned',
            'accepted',
            'in_progress',
            'picked_up',
            'delivered',
            'cancelled',
            'failed'
        ));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
    ALTER TABLE subscriptions
        ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active', 'trialing', 'past_due', 'canceled', 'expired', 'paused'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END
$$;
