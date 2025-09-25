BEGIN;

-- 1) UI events for CTR and A/B experiments
CREATE TABLE IF NOT EXISTS ui_events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL,
  experiment  TEXT,
  variant     TEXT,
  event       TEXT NOT NULL CHECK (event IN ('expose','click')),
  target      TEXT NOT NULL,
  context     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ui_events_user_time_idx ON ui_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ui_events_target_time_idx ON ui_events(target, created_at DESC);

-- 2) Purge expired idempotency keys
CREATE OR REPLACE FUNCTION purge_recent_actions() RETURNS VOID AS $$
BEGIN
  DELETE FROM recent_actions WHERE expires_at < now();
END; $$ LANGUAGE plpgsql;

COMMIT;
