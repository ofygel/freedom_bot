import test from 'node:test';
import assert from 'node:assert/strict';
import { resetTelegramSession, type Logger, type TelegramSessionApi } from '../src/utils/telegramSession';

test('resetTelegramSession performs webhook delete and close steps', async () => {
  const calls: string[] = [];
  const telegram: TelegramSessionApi = {
    deleteWebhook: async () => {
      calls.push('deleteWebhook');
      return true;
    },
    close: async () => {
      calls.push('close');
      return true;
    },
  };
  const logs: { level: 'warn' | 'error'; args: unknown[] }[] = [];
  const logger: Logger = {
    warn: (...args: unknown[]) => {
      logs.push({ level: 'warn', args });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: 'error', args });
    },
  };

  const result = await resetTelegramSession(telegram, logger);

  assert.equal(result, true);
  assert.deepEqual(calls, ['deleteWebhook', 'close']);
  const warnMessages = logs.filter((log) => log.level === 'warn').map((log) => String(log.args[0]));
  assert(warnMessages.includes('Deleted previous Telegram webhook via Telegram API.'));
  assert(warnMessages.includes('Closed previous Telegram session via Telegram API.'));
  assert.equal(logs.filter((log) => log.level === 'error').length, 0);
});

test('resetTelegramSession resolves when close succeeds after delete failure', async () => {
  const calls: string[] = [];
  const telegram: TelegramSessionApi = {
    deleteWebhook: async () => {
      calls.push('deleteWebhook');
      throw new Error('delete failed');
    },
    close: async () => {
      calls.push('close');
      return true;
    },
  };
  const logs: { level: 'warn' | 'error'; args: unknown[] }[] = [];
  const logger: Logger = {
    warn: (...args: unknown[]) => {
      logs.push({ level: 'warn', args });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: 'error', args });
    },
  };

  const result = await resetTelegramSession(telegram, logger);

  assert.equal(result, true);
  assert.deepEqual(calls, ['deleteWebhook', 'close']);
  const warnMessages = logs.filter((log) => log.level === 'warn').map((log) => String(log.args[0]));
  assert(warnMessages.includes('Failed to delete previous Telegram webhook via Telegram API.'));
  assert(warnMessages.includes('Closed previous Telegram session via Telegram API.'));
  assert.equal(logs.filter((log) => log.level === 'error').length, 0);
});

test('resetTelegramSession reports failure when no step succeeds', async () => {
  const telegram: TelegramSessionApi = {
    deleteWebhook: async () => {
      throw new Error('delete failed');
    },
    close: async () => {
      throw new Error('close failed');
    },
  };
  const logs: { level: 'warn' | 'error'; args: unknown[] }[] = [];
  const logger: Logger = {
    warn: (...args: unknown[]) => {
      logs.push({ level: 'warn', args });
    },
    error: (...args: unknown[]) => {
      logs.push({ level: 'error', args });
    },
  };

  const result = await resetTelegramSession(telegram, logger);

  assert.equal(result, false);
  const warnMessages = logs.filter((log) => log.level === 'warn').map((log) => String(log.args[0]));
  assert(warnMessages.includes('Failed to delete previous Telegram webhook via Telegram API.'));
  assert(warnMessages.includes('Failed to close previous Telegram session with close()'));
  const errorMessages = logs.filter((log) => log.level === 'error').map((log) => String(log.args[0]));
  assert(errorMessages.includes('Unable to reset Telegram session; all reset attempts failed.'));
});
