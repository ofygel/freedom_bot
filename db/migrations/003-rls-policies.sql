-- Enable RLS and define explicit policies for application tables
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON app_settings FOR SELECT USING (true);

ALTER TABLE callback_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON callback_map FOR SELECT USING (true);

ALTER TABLE courier_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON courier_profiles FOR SELECT USING (true);

ALTER TABLE courier_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON courier_verifications FOR SELECT USING (true);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON orders FOR SELECT USING (true);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON order_events FOR SELECT USING (true);

ALTER TABLE order_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON order_messages FOR SELECT USING (true);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON disputes FOR SELECT USING (true);

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON support_tickets FOR SELECT USING (true);

ALTER TABLE metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON metrics_daily FOR SELECT USING (true);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON rate_limits FOR SELECT USING (true);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON users FOR SELECT USING (true);

ALTER TABLE channel_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY select_all ON channel_bindings FOR SELECT USING (true);

-- Disable RLS on extension tables
DO $$
BEGIN
    BEGIN
        EXECUTE 'ALTER TABLE spatial_ref_sys DISABLE ROW LEVEL SECURITY';
    EXCEPTION
        WHEN insufficient_privilege THEN
            -- Ignore permission errors when the migration does not have access.
            NULL;
        WHEN undefined_table THEN
            -- Ignore when the extension table is not installed.
            NULL;
    END;
END;
$$;
