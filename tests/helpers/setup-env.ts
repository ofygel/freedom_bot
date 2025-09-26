const REQUIRED_ENV_DEFAULTS: Record<string, string> = {
  BOT_TOKEN: 'test-token',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  KASPI_CARD: '4400 0000 0000 0000',
  KASPI_NAME: 'Freedom Bot',
  KASPI_PHONE: '+7 (700) 000-00-00',
  WEBHOOK_DOMAIN: 'https://example.com',
  WEBHOOK_SECRET: 'test-secret',
};

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

for (const [key, value] of Object.entries(REQUIRED_ENV_DEFAULTS)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}

if (!process.env.DRIVERS_CHANNEL_ID) {
  process.env.DRIVERS_CHANNEL_ID = '-100200300';
}
