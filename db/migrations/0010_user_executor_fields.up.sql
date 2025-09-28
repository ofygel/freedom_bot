BEGIN;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'guest';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'executor';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'executor_kind') THEN
    CREATE TYPE executor_kind AS ENUM ('courier', 'driver');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_verify_status') THEN
    CREATE TYPE user_verify_status AS ENUM ('none', 'pending', 'active', 'rejected', 'expired');
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS executor_kind executor_kind,
  ADD COLUMN IF NOT EXISTS verify_status user_verify_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;

UPDATE users
SET executor_kind = CASE role
  WHEN 'courier' THEN 'courier'::executor_kind
  WHEN 'driver' THEN 'driver'::executor_kind
  ELSE executor_kind
END
WHERE role IN ('courier', 'driver');

UPDATE users
SET role = 'executor'
WHERE role IN ('courier', 'driver');

WITH latest AS (
  SELECT DISTINCT ON (user_id) user_id, status
  FROM verifications
  ORDER BY user_id, updated_at DESC, id DESC
)
UPDATE users AS u
SET verify_status = CASE
  WHEN u.is_verified THEN 'active'
  WHEN latest.status IS NULL THEN 'none'
  WHEN latest.status = 'active' THEN 'active'
  WHEN latest.status = 'pending' THEN 'pending'
  WHEN latest.status = 'rejected' THEN 'rejected'
  WHEN latest.status = 'expired' THEN 'expired'
  ELSE 'none'
END
FROM latest
WHERE u.tg_id = latest.user_id;

UPDATE users
SET verify_status = 'active'
WHERE verify_status = 'none' AND is_verified IS TRUE;

UPDATE users
SET trial_started_at = COALESCE(verified_at, trial_ends_at),
    trial_expires_at = trial_ends_at
WHERE trial_ends_at IS NOT NULL;

ALTER TABLE users
  DROP COLUMN IF EXISTS trial_ends_at,
  DROP COLUMN IF EXISTS is_verified;

COMMIT;
