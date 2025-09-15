# Freedom Bot

This repository contains a Telegram delivery aggregator bot for Almaty.

## Database

The bot can now use a PostgreSQL database. Run migrations to create tables and import existing JSON data:

```bash
npm run migrate
```

Core bot environment variables are defined in `.env.example`:

- `TELEGRAM_BOT_TOKEN` (required): Bot token issued by [@BotFather](https://t.me/BotFather).
- `ADMIN_ID` (required): Numeric Telegram user ID allowed to execute admin commands.
- `COURIERS_CHANNEL_ID` (required): Channel chat ID used for courier coordination.
- `MODERATORS_CHANNEL_ID` (required): Channel chat ID for moderator alerts.
- `CITY` (optional, default `almaty`): Default service city.
- `VERIFY_CHANNEL_ID` (optional): Channel chat ID that receives courier verification requests.
- `PROVIDER_TOKEN` (optional): Telegram payments provider token; leave unset to disable payments.
- `COURIER_SECRET` (optional, default `default_secret_key_32_bytes_long!`): Secret used to encrypt stored courier card data.

Optional pricing overrides can also be provided through environment variables. Each falls back to the default shown in `.env.example` when not set:

- `BASE_PRICE`
- `PER_KM`
- `SURCHARGE_S`
- `SURCHARGE_M`
- `SURCHARGE_L`
- `SURCHARGE_THERMOBOX`
- `SURCHARGE_CHANGE`
- `MIN_PRICE`
- `WAIT_FREE`
- `WAIT_PER_MIN`

Environment variables for the database are also defined in `.env.example`:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`
- `DB_SSL` (set to `true` when using Supabase)

### Using Supabase

To use [Supabase](https://supabase.com) as the database, map the connection details from the Supabase dashboard to these environment variables:

- `DB_HOST`: the host from the connection string (e.g. `db.<project>.supabase.co`)
- `DB_PORT`: the port number, usually `5432`
- `DB_USER`: the database user, typically `postgres`
- `DB_PASS`: the database password
- `DB_NAME`: the database name, usually `postgres`

Provide the Supabase API keys as well:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Supabase requires SSL connections, so set `DB_SSL=true` (or `PGSSLMODE=require`) before starting the bot or running migrations. With these variables configured, run migrations against Supabase:

```bash
npm run migrate
```

A simple backup script is available:

```bash
npm run backup
```

The SQL schema lives in `db/schema.sql` and includes tables such as `users`, `orders`, `support_tickets`, and others with necessary indexes and triggers for updating timestamps.
