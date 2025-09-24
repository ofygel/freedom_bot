-- Enforce explicit lifecycle states for bot users and sessions
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'guest'
    CHECK (status IN (
      'guest',
      'onboarding',
      'awaiting_phone',
      'active_client',
      'active_executor',
      'trial_expired',
      'suspended',
      'banned'
    )),
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_menu_role text
    CHECK (last_menu_role IN ('client', 'courier', 'moderator')),
  ADD COLUMN IF NOT EXISTS keyboard_nonce text DEFAULT gen_random_uuid()::text;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

UPDATE users
SET keyboard_nonce = gen_random_uuid()::text
WHERE keyboard_nonce IS NULL;

CREATE OR REPLACE FUNCTION rotate_keyboard_nonce() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.status IS DISTINCT FROM NEW.status)
       OR (OLD.role IS DISTINCT FROM NEW.role) THEN
      NEW.keyboard_nonce := gen_random_uuid()::text;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_rotate_nonce ON users;
CREATE TRIGGER trg_users_rotate_nonce
BEFORE UPDATE OF status, role ON users
FOR EACH ROW EXECUTE FUNCTION rotate_keyboard_nonce();

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS flow_state text,
  ADD COLUMN IF NOT EXISTS flow_payload jsonb DEFAULT '{}'::jsonb;
