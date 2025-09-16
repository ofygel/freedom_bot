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

## Subscription settings

- `SUB_PRICE_7`, `SUB_PRICE_15`, `SUB_PRICE_30` – Override subscription prices (in
  KZT) for 7, 15 and 30 day plans. Defaults are 5000, 9000 and 16000 respectively
  when the variables are omitted.
- `SUB_WARN_HOURS_BEFORE` – Number of hours before expiry when reminder messages are
  sent. Defaults to 24 hours. The value must be a positive number.
- `DRIVERS_CHANNEL_INVITE` – Optional fallback invite link delivered to executors when
  an automatic invite cannot be created.

## Location and geocoding

- `CITY_DEFAULT` – Optional default city appended to short address queries.
- `TWOGIS_API_KEY` – Enables the optional 2ГИС geocoding integration when present.
- `NOMINATIM_BASE` – Optional base URL for self‑hosted Nominatim instances. When
  provided, the bot derives `/search` and `/reverse` endpoints from this value.

## Tariff hints

The following values describe default tariff parameters used in external automations.
They are optional but must be defined together when used.

- `TARIFF_BASE` – Base fare applied to a new order.
- `TARIFF_PER_KM` – Distance component calculated per kilometre.
- `TARIFF_PER_MIN` – Time component calculated per minute.

