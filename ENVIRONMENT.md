# Environment configuration

Freedom Bot relies on a handful of environment variables. The sections below outline
which values are required and how optional settings can be used to fine‑tune the bot.

## Required variables

These variables must be present; the application will refuse to start if any of them
are missing or blank.

- `BOT_TOKEN` – Telegram bot token obtained via [@BotFather](https://t.me/BotFather).
- `DATABASE_URL` – PostgreSQL connection string used by the application layer.
- `KASPI_CARD` – Kaspi Gold card number shown in the subscription instructions.
- `KASPI_NAME` – Account holder name displayed alongside the Kaspi details.
- `KASPI_PHONE` – Contact phone number provided with the Kaspi payment details.
- `WEBHOOK_DOMAIN` – Publicly reachable base URL used to register the Telegram webhook
  endpoint (for example, `https://bot.example.com`).
- `WEBHOOK_SECRET` – Secret token appended to the webhook path to prevent unsolicited
  requests. Use a sufficiently long random string.

## Database options

- `DATABASE_SSL` – Enables TLS for the PostgreSQL connection when set to `true`,
  `1` or `yes`. The connection negotiates SSL with certificate validation. Leave
  the variable unset (or explicitly set it to `false`) to connect without TLS.
- `DATABASE_POOL_MAX` – Maximum number of concurrent client connections in the
  PostgreSQL pool. Defaults to `10` when not specified.
- `DATABASE_POOL_IDLE_TIMEOUT_MS` – Time (in milliseconds) after which idle
  connections are closed. The default is `30000` (30 seconds).
- `DATABASE_POOL_CONNECTION_TIMEOUT_MS` – Maximum time (in milliseconds) the
  driver waits for an available connection before failing. Defaults to `5000`.
- `DATABASE_STATEMENT_TIMEOUT_MS` – Upper bound (in milliseconds) enforced for
  individual SQL statements. Defaults to `15000` to ensure the bot responds
  before Telegram retries the update delivery.
- `DATABASE_QUERY_TIMEOUT_MS` – Safety timeout (in milliseconds) applied by the
  driver to each query. Defaults to `20000` and should be equal to or greater
  than the statement timeout.

## Session cache

- `REDIS_URL` – Optional Redis connection string. When provided, Freedom Bot
  mirrors the per-user session payload in Redis to shield conversations from
  short-lived PostgreSQL outages.
- `SESSION_TTL_SECONDS` – Session cache expiration in seconds. Defaults to
  86400 (24 hours). Lower the value to reduce memory usage when Redis is
  shared with other services.
- `SESSION_CACHE_PREFIX` – Prefix appended to Redis keys that store session
  payloads. Defaults to `session:`.

## Subscription settings

- `SUB_PRICE_7`, `SUB_PRICE_15`, `SUB_PRICE_30` – Override subscription prices (in
  KZT) for 7, 15 and 30 day plans. Defaults are 5000, 9000 and 16000 respectively
  when the variables are omitted.
- `SUB_WARN_HOURS_BEFORE` – Number of hours before expiry when reminder messages are
  sent. Defaults to 24 hours. The value must be a positive number.
- `DRIVERS_CHANNEL_ID` – Optional numeric identifier used to seed the drivers channel
  binding when `/bind_drivers_channel` has not been executed yet. Provide the full
  chat ID (including the leading `-100` prefix for Telegram supergroups) to skip the
  manual binding step during initial deployments.
- `DRIVERS_CHANNEL_INVITE` – Optional fallback invite link delivered to executors when
  an automatic invite cannot be created.

## Feature toggles

- `FEATURE_TRIAL_ENABLED` – Controls whether executors can activate the free trial
  subscription period from the bot. Enabled by default; set to `false` to disable
  the trial offer entirely.

## Location and geocoding

- `CITY_DEFAULT` – Optional default city appended to short address queries.
- `TWOGIS_API_KEY` – Enables the optional 2ГИС geocoding integration, including
  `/geo/...` and `/firm/...` links when present.
- `NOMINATIM_BASE` – Optional base URL for self‑hosted Nominatim instances. When
  provided, the bot derives `/search` and `/reverse` endpoints from this value.

## Executor pricing overrides

These settings adjust the default tariffs displayed to executors in task previews.
Omitting any of them keeps the built-in defaults.

- `TAXI_BASE_FARE`, `TAXI_PER_KM`, `TAXI_MINIMUM_FARE` – Taxi pricing in KZT. The
  defaults are 700, 200 and 700 respectively.
- `DELIVERY_BASE_FARE`, `DELIVERY_PER_KM`, `DELIVERY_MINIMUM_FARE` – Delivery
  pricing in KZT. The defaults are 900, 250 and 900 respectively.

## Tariff hints

The following values describe default tariff parameters used in external automations.
They are optional but must be defined together when used. When present, Freedom Bot
applies them to taxi price quotes shown to customers and executors using the
`base + per_km * distance + per_min * eta` formula. Delivery quotes continue to rely
on the configured delivery tariffs. The ETA is approximated with a 5-minute pickup
buffer and an average city speed of roughly 27 km/h, then rounded to the nearest
minute before calculating the time component. The final quote is rounded to the
nearest tenge for consistency with legacy pricing.

- `TARIFF_BASE` – Base fare applied to a new order.
- `TARIFF_PER_KM` – Distance component calculated per kilometre.
- `TARIFF_PER_MIN` – Time component calculated per minute.

## Webhook server

- `PORT` – TCP port the internal HTTP server listens on. Defaults to `3000` when
  the variable is not provided.

