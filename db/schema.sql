-- SQL schema for Freedom Bot
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  role TEXT CHECK (role IN ('client','driver','courier','admin')),
  phone TEXT UNIQUE,
  city TEXT,
  consent BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Courier profiles
CREATE TABLE IF NOT EXISTS courier_profiles (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name TEXT,
  vehicle_type TEXT,
  license_plate TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Courier verifications
CREATE TABLE IF NOT EXISTS courier_verifications (
  id SERIAL PRIMARY KEY,
  courier_id BIGINT REFERENCES courier_profiles(user_id) ON DELETE CASCADE,
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

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  client_id BIGINT REFERENCES users(id),
  courier_id BIGINT REFERENCES users(id),
  status TEXT CHECK (status IN ('new','assigned','delivered','canceled')) DEFAULT 'new',
  price INTEGER,
  pickup GEOGRAPHY(Point,4326),
  dropoff GEOGRAPHY(Point,4326),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_pickup_gix ON orders USING GIST (pickup);
CREATE INDEX IF NOT EXISTS orders_dropoff_gix ON orders USING GIST (dropoff);

-- Order events
CREATE TABLE IF NOT EXISTS order_events (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Order messages
CREATE TABLE IF NOT EXISTS order_messages (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  sender_id BIGINT REFERENCES users(id),
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Disputes
CREATE TABLE IF NOT EXISTS disputes (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  user_id BIGINT REFERENCES users(id),
  status TEXT CHECK (status IN ('open','resolved','rejected')) DEFAULT 'open',
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Support tickets
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
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

-- Trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

-- callback_map policies (service role only)
DROP POLICY IF EXISTS service_all ON callback_map;
CREATE POLICY service_all ON callback_map FOR ALL USING (auth.role() = 'service_role');

-- rate_limits policies (service role only)
DROP POLICY IF EXISTS service_all ON rate_limits;
CREATE POLICY service_all ON rate_limits FOR ALL USING (auth.role() = 'service_role');

-- metrics_daily policies (service role only)
DROP POLICY IF EXISTS service_all ON metrics_daily;
CREATE POLICY service_all ON metrics_daily FOR ALL USING (auth.role() = 'service_role');

