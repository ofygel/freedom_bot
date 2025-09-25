BEGIN;

-- Extend session metadata with flow tracking fields
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS flow_state TEXT,
  ADD COLUMN IF NOT EXISTS flow_payload JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_step_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nudge_sent_at TIMESTAMPTZ;

-- Journal FSM transitions for diagnostics
CREATE TABLE IF NOT EXISTS fsm_journal (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL,
  scope_id BIGINT NOT NULL,
  from_state TEXT,
  to_state   TEXT,
  step_id    TEXT,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fsm_journal_scope_idx
  ON fsm_journal(scope, scope_id, created_at DESC);

-- Idempotency guard for user actions
CREATE TABLE IF NOT EXISTS recent_actions (
  user_id    BIGINT NOT NULL,
  key        TEXT   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS recent_actions_expires_idx ON recent_actions(expires_at);

-- Remember last used locations for quick re-ordering
CREATE TABLE IF NOT EXISTS user_recent_locations (
  user_id   BIGINT NOT NULL,
  city      TEXT   NOT NULL,
  kind      TEXT   NOT NULL CHECK (kind IN ('pickup','dropoff')),
  location_id TEXT NOT NULL,
  query     TEXT   NOT NULL,
  address   TEXT   NOT NULL,
  lat       DOUBLE PRECISION NOT NULL,
  lon       DOUBLE PRECISION NOT NULL,
  two_gis_url TEXT,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, city, kind, location_id),
  UNIQUE (user_id, city, kind, address)
);

CREATE INDEX IF NOT EXISTS user_recent_locations_last_used_idx
  ON user_recent_locations(user_id, city, kind, last_used_at DESC);

-- Keep only the latest five locations per user/city/kind
CREATE OR REPLACE FUNCTION trim_user_recent_locations() RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM user_recent_locations
  WHERE ctid IN (
    SELECT ctid
    FROM user_recent_locations
    WHERE user_id = NEW.user_id
      AND city = NEW.city
      AND kind = NEW.kind
    ORDER BY last_used_at DESC
    OFFSET 5
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_trim_user_recent_locations ON user_recent_locations;
CREATE TRIGGER trg_trim_user_recent_locations
AFTER INSERT ON user_recent_locations
FOR EACH ROW EXECUTE FUNCTION trim_user_recent_locations();

-- Experiment assignments for lightweight A/B tests
CREATE TABLE IF NOT EXISTS user_experiments (
  user_id    BIGINT NOT NULL,
  experiment TEXT   NOT NULL,
  variant    TEXT   NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, experiment)
);

COMMIT;
