-- Add reservation fields to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reserved_by UUID,
  ADD COLUMN IF NOT EXISTS reserved_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_reserved_until ON orders(reserved_until);

-- Attempt to reserve an open order for a courier
CREATE OR REPLACE FUNCTION fn_try_reserve_order(
  p_order_id INT,
  p_courier UUID,
  p_hold_seconds INT DEFAULT 90
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE v_rowcount INT;
BEGIN
  UPDATE orders
     SET status='reserved',
         reserved_by = p_courier,
         reserved_until = now() + make_interval(secs => p_hold_seconds),
         updated_at = now()
   WHERE id = p_order_id
     AND status = 'open'
     AND (reserved_until IS NULL OR reserved_until < now());

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RETURN v_rowcount = 1;
END$$;

-- Confirm start and assign courier to an order
CREATE OR REPLACE FUNCTION fn_confirm_start(
  p_order_id INT,
  p_courier UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql AS $$
DECLARE v_rowcount INT;
BEGIN
  UPDATE orders
     SET status='assigned',
         courier_id = p_courier,
         updated_at = now()
   WHERE id = p_order_id
     AND status = 'reserved'
     AND reserved_by = p_courier
     AND reserved_until > now();

  GET DIAGNOSTICS v_rowcount = ROW_COUNT;
  RETURN v_rowcount = 1;
END$$;

-- Reopen orders whose reservations have expired
CREATE OR REPLACE FUNCTION fn_reopen_expired_reservations()
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE v_cnt INT;
BEGIN
  UPDATE orders
     SET status='open',
         reserved_by = NULL,
         reserved_until = NULL,
         updated_at = now()
   WHERE status='reserved' AND reserved_until < now();

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  RETURN v_cnt;
END$$;
