-- Required extensions
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role TEXT CHECK (role IN ('client','courier','admin')),
  phone TEXT UNIQUE,
  city TEXT,
  consent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  vehicle_type TEXT,
  license_plate TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courier_verifications (
  id SERIAL PRIMARY KEY,
  courier_id UUID REFERENCES courier_profiles(user_id) ON DELETE CASCADE,
  status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Application settings
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Orders table extended for bot workflow
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  client_id UUID REFERENCES users(id),
  courier_id UUID REFERENCES users(id),
  status TEXT CHECK (status IN (
    'open','reserved','assigned',
    'going_to_pickup','at_pickup','picked',
    'going_to_dropoff','at_dropoff',
    'delivered','closed','dispute_open','canceled'
  )) DEFAULT 'open',
  price INTEGER,
  pickup GEOGRAPHY(Point,4326),
  dropoff GEOGRAPHY(Point,4326),
  -- when and payment details
  when_type TEXT CHECK (when_type IN ('now','scheduled')) DEFAULT 'now',
  scheduled_at TIMESTAMPTZ,
  pay_type TEXT CHECK (pay_type IN ('cash','p2p','receiver')) DEFAULT 'cash',
  p2p_client_marked BOOLEAN DEFAULT false,
  p2p_client_proof TEXT,
  p2p_courier_confirmed BOOLEAN DEFAULT false,
  -- human readable addresses
  pickup_addr TEXT,
  dropoff_addr TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_pickup_gix ON orders USING GIST (pickup);
CREATE INDEX IF NOT EXISTS orders_dropoff_gix ON orders USING GIST (dropoff);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_courier ON orders(courier_id);

-- Order events
CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_messages (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  sender_id UUID REFERENCES users(id),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  user_id UUID REFERENCES users(id),
  status TEXT CHECK (status IN ('open','resolved','rejected')) DEFAULT 'open',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  subject TEXT,
  status TEXT CHECK (status IN ('open','pending','closed')) DEFAULT 'open',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Callback map
CREATE TABLE IF NOT EXISTS callback_map (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE,
  data JSONB,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Rate limits
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE,
  count INTEGER,
  expires_at TIMESTAMPTZ
);

-- Daily metrics
CREATE TABLE IF NOT EXISTS metrics_daily (
  day DATE PRIMARY KEY,
  data JSONB
);

-- Channel bindings
CREATE TABLE IF NOT EXISTS channel_bindings (
  city      TEXT NOT NULL DEFAULT 'almaty',
  kind      TEXT NOT NULL CHECK (kind IN ('verify','drivers')),
  chat_id   BIGINT NOT NULL,
  title     TEXT,
  bound_by  BIGINT,
  bound_at  TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (city, kind)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_bindings_chat_kind
  ON channel_bindings (chat_id, kind);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated ON users;
CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_courier_profiles_updated ON courier_profiles;
CREATE TRIGGER trg_courier_profiles_updated
BEFORE UPDATE ON courier_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_courier_verifications_updated ON courier_verifications;
CREATE TRIGGER trg_courier_verifications_updated
BEFORE UPDATE ON courier_verifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_app_settings_updated ON app_settings;
CREATE TRIGGER trg_app_settings_updated
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated ON orders;
CREATE TRIGGER trg_orders_updated
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_disputes_updated ON disputes;
CREATE TRIGGER trg_disputes_updated
BEFORE UPDATE ON disputes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_support_tickets_updated ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_channel_bindings_updated ON channel_bindings;
CREATE TRIGGER trg_channel_bindings_updated
BEFORE UPDATE ON channel_bindings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Enable row level security on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE callback_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_bindings ENABLE ROW LEVEL SECURITY;

-- spatial_ref_sys is a system table; leave it untouched
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'spatial_ref_sys'
  ) THEN
    RAISE NOTICE 'leave spatial_ref_sys as-is';
  END IF;
END;
$$;

-- Row level security policies

-- app_settings accessible to all authenticated users
DROP POLICY IF EXISTS select_all ON app_settings;
CREATE POLICY select_all ON app_settings FOR SELECT USING (true);

-- users table policies
DROP POLICY IF EXISTS user_is_owner ON users;
CREATE POLICY user_is_owner ON users FOR ALL USING (auth.uid() = id);
DROP POLICY IF EXISTS service_all ON users;
CREATE POLICY service_all ON users FOR ALL USING (auth.role() = 'service_role');

-- courier_profiles policies
DROP POLICY IF EXISTS user_is_owner ON courier_profiles;
CREATE POLICY user_is_owner ON courier_profiles FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS service_all ON courier_profiles;
CREATE POLICY service_all ON courier_profiles FOR ALL USING (auth.role() = 'service_role');

-- courier_verifications policies
DROP POLICY IF EXISTS user_is_owner ON courier_verifications;
CREATE POLICY user_is_owner ON courier_verifications FOR ALL USING (auth.uid() = courier_id);
DROP POLICY IF EXISTS service_all ON courier_verifications;
CREATE POLICY service_all ON courier_verifications FOR ALL USING (auth.role() = 'service_role');

-- orders policies
DROP POLICY IF EXISTS user_is_owner ON orders;
CREATE POLICY user_is_owner ON orders FOR ALL USING (
  auth.uid() = client_id OR auth.uid() = courier_id
);
DROP POLICY IF EXISTS service_all ON orders;
CREATE POLICY service_all ON orders FOR ALL USING (auth.role() = 'service_role');

-- order_events policies
DROP POLICY IF EXISTS user_is_owner ON order_events;
CREATE POLICY user_is_owner ON order_events FOR ALL USING (
  EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_events.order_id
      AND (auth.uid() = o.client_id OR auth.uid() = o.courier_id)
  )
);
DROP POLICY IF EXISTS service_all ON order_events;
CREATE POLICY service_all ON order_events FOR ALL USING (auth.role() = 'service_role');

-- order_messages policies
DROP POLICY IF EXISTS user_is_owner ON order_messages;
CREATE POLICY user_is_owner ON order_messages FOR ALL USING (
  auth.uid() = sender_id OR EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = order_messages.order_id
      AND (auth.uid() = o.client_id OR auth.uid() = o.courier_id)
  )
);
DROP POLICY IF EXISTS service_all ON order_messages;
CREATE POLICY service_all ON order_messages FOR ALL USING (auth.role() = 'service_role');

-- disputes policies
DROP POLICY IF EXISTS user_is_owner ON disputes;
CREATE POLICY user_is_owner ON disputes FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS service_all ON disputes;
CREATE POLICY service_all ON disputes FOR ALL USING (auth.role() = 'service_role');

-- support_tickets policies
DROP POLICY IF EXISTS user_is_owner ON support_tickets;
CREATE POLICY user_is_owner ON support_tickets FOR ALL USING (auth.uid() = user_id);
DROP POLICY IF EXISTS service_all ON support_tickets;
CREATE POLICY service_all ON support_tickets FOR ALL USING (auth.role() = 'service_role');

-- channel_bindings policies
DROP POLICY IF EXISTS service_all ON channel_bindings;
CREATE POLICY service_all ON channel_bindings FOR ALL USING (auth.role() = 'service_role');

-- callback_map policies (service role only)
DROP POLICY IF EXISTS service_all ON callback_map;
CREATE POLICY service_all ON callback_map FOR ALL USING (auth.role() = 'service_role');

-- rate_limits policies (service role only)
DROP POLICY IF EXISTS service_all ON rate_limits;
CREATE POLICY service_all ON rate_limits FOR ALL USING (auth.role() = 'service_role');

-- metrics_daily policies (service role only)
DROP POLICY IF EXISTS service_all ON metrics_daily;
CREATE POLICY service_all ON metrics_daily FOR ALL USING (auth.role() = 'service_role');

-- Channel binding utilities
CREATE OR REPLACE FUNCTION upsert_setting(p_key TEXT, p_value JSONB)
RETURNS VOID LANGUAGE sql AS $$
  INSERT INTO app_settings(key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        updated_at = now();
$$;

CREATE OR REPLACE FUNCTION bind_channel(
  p_kind TEXT,
  p_city TEXT,
  p_chat_id BIGINT,
  p_title TEXT,
  p_admin_tg_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_kind NOT IN ('verify','drivers') THEN
    RAISE EXCEPTION 'unknown kind: %', p_kind;
  END IF;

  INSERT INTO channel_bindings(city, kind, chat_id, title, bound_by, bound_at)
  VALUES (COALESCE(p_city,'almaty'), p_kind, p_chat_id, p_title, p_admin_tg_id, now())
  ON CONFLICT (city, kind) DO UPDATE
    SET chat_id   = EXCLUDED.chat_id,
        title     = EXCLUDED.title,
        bound_by  = EXCLUDED.bound_by,
        bound_at  = now(),
        updated_at= now();

  PERFORM upsert_setting(p_kind || '_channel_id',
                         jsonb_build_object('chat_id', p_chat_id, 'title', p_title, 'city', COALESCE(p_city,'almaty')));
END;
$$;

CREATE OR REPLACE FUNCTION get_channel_binding(p_kind TEXT, p_city TEXT DEFAULT 'almaty')
RETURNS TABLE (chat_id BIGINT, title TEXT)
LANGUAGE sql STABLE AS $$
  SELECT chat_id, title
  FROM channel_bindings
  WHERE kind = p_kind AND city = COALESCE(p_city,'almaty');
$$;

CREATE OR REPLACE VIEW v_channel_bindings AS
SELECT city, kind, chat_id, title, bound_by, bound_at
FROM channel_bindings;

-- Views and functions for "My orders"
CREATE OR REPLACE VIEW v_my_orders_client AS
SELECT id, status, price, created_at, updated_at, pickup_addr, dropoff_addr
FROM orders
WHERE client_id = auth.uid()
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW v_my_orders_courier AS
SELECT id, status, price, created_at, updated_at, pickup_addr, dropoff_addr
FROM orders
WHERE courier_id = auth.uid()
ORDER BY created_at DESC;

CREATE OR REPLACE FUNCTION get_orders_for_client(p_client_id UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (id INT, status TEXT, price INT, created_at TIMESTAMPTZ, pickup_addr TEXT, dropoff_addr TEXT)
LANGUAGE sql STABLE AS $$
  SELECT id, status, price, created_at, pickup_addr, dropoff_addr
  FROM orders
  WHERE client_id = p_client_id
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION get_orders_for_courier(p_courier_id UUID, p_limit INT DEFAULT 50)
RETURNS TABLE (id INT, status TEXT, price INT, created_at TIMESTAMPTZ, pickup_addr TEXT, dropoff_addr TEXT)
LANGUAGE sql STABLE AS $$
  SELECT id, status, price, created_at, pickup_addr, dropoff_addr
  FROM orders
  WHERE courier_id = p_courier_id
  ORDER BY created_at DESC
  LIMIT p_limit;
$$;

-- Validate and advance order status
CREATE OR REPLACE FUNCTION fn_advance_status(
  p_order_id INT,
  p_actor UUID,
  p_to TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE v_from TEXT;
DECLARE ok BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_from FROM orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  IF    v_from='assigned'          AND p_to='going_to_pickup'  THEN ok := TRUE;
  ELSIF v_from='going_to_pickup'   AND p_to='at_pickup'        THEN ok := TRUE;
  ELSIF v_from='at_pickup'         AND p_to='picked'           THEN ok := TRUE;
  ELSIF v_from='picked'            AND p_to='going_to_dropoff' THEN ok := TRUE;
  ELSIF v_from='going_to_dropoff'  AND p_to='at_dropoff'       THEN ok := TRUE;
  ELSIF v_from='at_dropoff'        AND p_to='delivered'        THEN ok := TRUE;
  ELSIF v_from='delivered'         AND p_to='closed'           THEN ok := TRUE;
  END IF;

  IF NOT ok THEN RETURN FALSE; END IF;

  UPDATE orders SET status=p_to, updated_at=now() WHERE id=p_order_id;
  RETURN TRUE;
END$$;

-- Mark that client sent P2P payment proof
CREATE OR REPLACE FUNCTION fn_payment_p2p_mark(
  p_order_id INT,
  p_proof TEXT
)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE orders
     SET p2p_client_marked = TRUE,
         p2p_client_proof  = p_proof,
         updated_at = now()
   WHERE id = p_order_id;
$$;

-- Courier confirmed P2P payment reception
CREATE OR REPLACE FUNCTION fn_payment_p2p_confirm(
  p_order_id INT
)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE orders
     SET p2p_courier_confirmed = TRUE,
         updated_at = now()
   WHERE id = p_order_id;
$$;
