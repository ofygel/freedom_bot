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

## Database options

- `DATABASE_SSL` – Enables TLS for the PostgreSQL connection when set to `true`,
  `1` or `yes`. The connection negotiates SSL with certificate validation. Leave
  the variable unset (or explicitly set it to `false`) to connect without TLS.

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
also applies them to price quotes shown to customers and executors using the
`base + per_km * distance + per_min * eta` formula. The ETA is approximated with a
5-minute pickup buffer and an average city speed of roughly 27 km/h, then rounded
to the nearest minute before calculating the time component. The final quote is
rounded to the nearest tenge for consistency with legacy pricing.

- `TARIFF_BASE` – Base fare applied to a new order.
- `TARIFF_PER_KM` – Distance component calculated per kilometre.
- `TARIFF_PER_MIN` – Time component calculated per minute.

