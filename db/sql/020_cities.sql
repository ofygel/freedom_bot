-- Introduce shared city enum and link it to users and orders
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_city') THEN
    CREATE TYPE app_city AS ENUM ('almaty', 'astana', 'shymkent', 'karaganda');
  END IF;
END $$;

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS city_selected app_city;

ALTER TABLE IF EXISTS orders
  ADD COLUMN IF NOT EXISTS city app_city;

UPDATE orders SET city = 'almaty' WHERE city IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_city ON orders(city);
CREATE INDEX IF NOT EXISTS idx_users_city_selected ON users(city_selected);
