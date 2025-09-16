-- Follow-up adjustments supporting runtime query patterns.

-- Ensure metadata columns fall back to empty objects when omitted in inserts.
ALTER TABLE subscriptions
    ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

ALTER TABLE subscription_payments
    ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

ALTER TABLE orders
    ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;

-- Helpful indexes for frequent lookups.
CREATE INDEX IF NOT EXISTS idx_verifications_user_type_status
    ON verifications(user_id, type, status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_chat_id
    ON subscriptions(chat_id);
