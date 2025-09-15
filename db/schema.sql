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

CREATE TRIGGER trg_users_updated
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_courier_profiles_updated
BEFORE UPDATE ON courier_profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_courier_verifications_updated
BEFORE UPDATE ON courier_verifications
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_app_settings_updated
BEFORE UPDATE ON app_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_orders_updated
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_disputes_updated
BEFORE UPDATE ON disputes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_support_tickets_updated
BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Enable row level security on all tables
ALTER TABLE spatial_ref_sys ENABLE ROW LEVEL SECURITY;
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

