-- Improve performance for session lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS sessions_scope_state_idx ON sessions (scope, scope_id);
