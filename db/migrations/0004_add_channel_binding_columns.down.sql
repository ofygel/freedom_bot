BEGIN;

ALTER TABLE channels
  DROP COLUMN IF EXISTS drivers_channel_id,
  DROP COLUMN IF EXISTS verify_channel_id,
  DROP COLUMN IF EXISTS stats_channel_id;

COMMIT;
