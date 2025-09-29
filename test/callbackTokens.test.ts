import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.BOT_TOKEN = process.env.BOT_TOKEN ?? 'test-token';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/db';
process.env.KASPI_CARD = process.env.KASPI_CARD ?? '1234';
process.env.KASPI_NAME = process.env.KASPI_NAME ?? 'Test User';
process.env.KASPI_PHONE = process.env.KASPI_PHONE ?? '+70000000000';
process.env.WEBHOOK_DOMAIN = process.env.WEBHOOK_DOMAIN ?? 'example.com';
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'secret';

void (async () => {
  const { wrapCallbackData } = await import('../src/bot/services/callbackTokens');
  const { ROLE_PICK_EXECUTOR_ACTION } = await import('../src/bot/flows/executor/roleSelectionConstants');

  const secret = 'test-secret';

  const wrapped = wrapCallbackData(ROLE_PICK_EXECUTOR_ACTION, {
    secret,
    userId: 987654321,
    keyboardNonce: 'keyboard-nonce',
    bindToUser: true,
    ttlSeconds: 300,
  });

  assert.ok(
    wrapped.length <= 64,
    'Wrapped callback data for ROLE_PICK_EXECUTOR_ACTION must fit into 64 characters',
  );
  assert.notEqual(
    wrapped,
    ROLE_PICK_EXECUTOR_ACTION,
    'Binding metadata should be applied when callback data fits within the allowed length',
  );
  assert.ok(
    wrapped.includes('#'),
    'Wrapped callback data should contain the metadata separator',
  );

  let oversizeOutcome: import('../src/bot/services/callbackTokens').WrapCallbackOutcome | undefined;
  const longRaw = 'x'.repeat(63);
  const oversizeWrapped = wrapCallbackData(longRaw, {
    secret,
    userId: 111111,
    keyboardNonce: 'nonce-value',
    bindToUser: true,
    ttlSeconds: 120,
    onResult: (outcome) => {
      oversizeOutcome = outcome;
    },
  });

  assert.ok(oversizeWrapped.length <= 64, 'Guarded callback data should never exceed 64 characters');
  assert.equal(
    oversizeWrapped,
    longRaw.slice(0, 64),
    'Oversized callbacks should fall back to an unwrapped payload',
  );
  assert.ok(
    oversizeOutcome && oversizeOutcome.status === 'skipped' && oversizeOutcome.reason === 'oversize',
    'Oversized callback data should be reported as skipped due to oversize',
  );

  console.log('callback tokens length guard test: OK');
})();
