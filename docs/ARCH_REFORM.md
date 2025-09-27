# Structural reliability reforms

This document tracks the resilience-focused changes introduced after the bot
started freezing during executor onboarding and city selection.

## Session storage hardening

- **Redis cache (optional):** When `REDIS_URL` is provided the bot mirrors every
  session payload to Redis with a 24-hour TTL (`SESSION_TTL_SECONDS`). Updates
  continue to persist in PostgreSQL, but the middleware now restores the cached
  session whenever the database connection pool is exhausted or temporarily
  unavailable, so `/start` and city callbacks keep working without wiping the
  user row.
- **Graceful cache clearing:** `clearSession` and the middleware pipeline delete
  Redis keys after successful logout/reset to prevent stale executor roles from
  leaking into new conversations.

## Verification flow recovery

- `/start`, `/menu`, `/help`, executor menu callbacks and role switches are now
  explicitly whitelisted while documents are being collected. Executors can
  reopen the menu or change their role without waiting for moderation.
- Non-photo messages during the "collecting" state trigger a throttled reminder
  (“Жду две фотографии документов, чтобы продолжить.”) instead of silently
  dropping the update. The last reminder timestamp is tracked in the session to
  avoid spamming the chat more than once per minute.

## Database loosened coupling

- New migration `0007_orders_soft_fk` switches the `orders.client_id` and
  `orders.claimed_by` foreign keys to `ON DELETE SET NULL`, so deleting a user no
  longer requires purging their historical orders first.

These changes reduce the bot’s sensitivity to transient PostgreSQL failures and
make the executor onboarding flow recoverable without manual session purges.
