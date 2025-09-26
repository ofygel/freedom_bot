BEGIN;

/* ---------- EXTENSIONS ---------- */
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

/* ---------- ENUM TYPES ---------- */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('client', 'courier', 'driver', 'moderator');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_kind') THEN
    CREATE TYPE order_kind AS ENUM ('taxi', 'delivery');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'order_status') THEN
    CREATE TYPE order_status AS ENUM ('open', 'claimed', 'cancelled', 'done');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM ('active', 'grace', 'expired');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
    CREATE TYPE verification_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

/* ---------- CORE TABLES ---------- */
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY        DEFAULT gen_random_uuid(),
  tg_id            BIGINT       UNIQUE     NOT NULL,               -- telegram user id
  role             user_role    NOT NULL   DEFAULT 'client',
  phone            TEXT         UNIQUE,
  phone_verified   BOOLEAN      NOT NULL   DEFAULT FALSE,
  first_name       TEXT,
  last_name        TEXT,
  username         TEXT,
  city             TEXT,
  consent          BOOLEAN      NOT NULL   DEFAULT FALSE,
  created_at       TIMESTAMPTZ  NOT NULL   DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL   DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_tg_id_role ON users (tg_id, role);

--------------------------------------------------------------------
/* Clean up stale FK if an old migration created it incorrectly */
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'sessions_scope_id_fkey'
    AND    table_name = 'sessions'
  ) THEN
    ALTER TABLE sessions DROP CONSTRAINT sessions_scope_id_fkey;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  scope            TEXT        NOT NULL,
  scope_id         BIGINT      NOT NULL,
  state            JSONB       NOT NULL  DEFAULT '{}'::jsonb,
  flow_state       TEXT,
  flow_payload     JSONB,
  last_step_at     TIMESTAMPTZ,
  nudge_sent_at    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'sessions_scope_id_fkey'
    AND    table_name = 'sessions'
  ) THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_scope_id_fkey
        FOREIGN KEY (scope_id) REFERENCES users(tg_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_scope_id ON sessions (scope_id);

--------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recent_actions (
  idempotency_key  TEXT        PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  action           TEXT        NOT NULL,
  hash             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recent_actions_user ON recent_actions (user_id);

--------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id               BIGSERIAL PRIMARY KEY,
  kind             order_kind      NOT NULL,
  status           order_status    NOT NULL DEFAULT 'open',
  client_id        BIGINT          NOT NULL REFERENCES users(tg_id),
  executor_id      BIGINT          REFERENCES users(tg_id),
  route_from       POINT,
  route_to         POINT,
  payload          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_client_id    ON orders (client_id);
CREATE INDEX IF NOT EXISTS idx_orders_executor_id  ON orders (executor_id);
/* Spatial indexes are intentionally omitted because the schema avoids
   PostGIS dependencies by using the native POINT type. */

--------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
  id               BIGSERIAL PRIMARY KEY,
  short_id         TEXT        UNIQUE,
  user_id          BIGINT      NOT NULL REFERENCES users(tg_id),
  chat_id          BIGINT      NOT NULL,     -- id чата-канала с заказами
  status           subscription_status NOT NULL DEFAULT 'active',
  days             INT         NOT NULL,
  next_billing_at  TIMESTAMPTZ,
  grace_until      TIMESTAMPTZ,
  last_warning_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions (user_id);

--------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(tg_id),
  amount           NUMERIC(12,2) NOT NULL,
  status           TEXT        NOT NULL,          -- 'pending','succeeded','failed'
  provider_payload JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

--------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS executor_verifications (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT      UNIQUE NOT NULL REFERENCES users(tg_id),
  status           verification_status  NOT NULL DEFAULT 'pending',
  photo_url        TEXT,
  comment          TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

--------------------------------------------------------------------
/* Джорнэл FSM-событий (для отладки / аналитики) */
CREATE TABLE IF NOT EXISTS fsm_journal (
  id               BIGSERIAL PRIMARY KEY,
  user_id          BIGINT,
  scope            TEXT,
  event            TEXT,
  payload          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fsm_journal_user ON fsm_journal (user_id);

--------------------------------------------------------------------
/* Вьюхи «Мои заказы» для клиента и курьера */
DROP VIEW IF EXISTS v_client_orders;
DROP VIEW IF EXISTS v_executor_orders;

CREATE VIEW v_client_orders AS
SELECT o.*, u.username AS executor_username
FROM   orders o
LEFT   JOIN users u ON u.tg_id = o.executor_id;

CREATE VIEW v_executor_orders AS
SELECT o.*, u.username AS client_username
FROM   orders o
LEFT   JOIN users u ON u.tg_id = o.client_id;

/* ---------- INITIAL DATA ---------- */
-- пример системных строк (необязательно)
INSERT INTO users (tg_id, role, phone_verified, phone)
VALUES
  (0, 'moderator', true, '+70000000000')      -- системный админ-бот
ON CONFLICT (tg_id) DO NOTHING;

COMMIT;
