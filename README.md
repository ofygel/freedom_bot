# Freedom Bot

This repository contains a Telegram delivery aggregator bot for Almaty.

## Database

The bot can now use a PostgreSQL database. Run migrations to create tables and import existing JSON data:

```bash
npm run migrate
```

Environment variables for the database are defined in `.env.example`:

- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASS`
- `DB_NAME`

A simple backup script is available:

```bash
npm run backup
```

The SQL schema lives in `db/schema.sql` and includes tables such as `users`, `orders`, `support_tickets`, and others with necessary indexes and triggers for updating timestamps.
