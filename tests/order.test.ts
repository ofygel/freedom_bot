import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import registerOrder from '../src/commands/order';
import { createMockBot, sendUpdate } from './helpers';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  const bot = createMockBot(messages);
  registerOrder(bot);
  return { dir, prev, bot, messages };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('geofence rejects points outside city', async () => {
  const { dir, prev, bot, messages } = setup();
  try {
    await sendUpdate(bot, {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: '/order',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: 'Доставка',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 3,
      message: {
        message_id: 3,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        location: { latitude: 44.0, longitude: 75.0 },
      } as any,
    });
    assert.equal(
      messages.at(-1)?.text,
      'Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.'
    );
  } finally {
    teardown(dir, prev);
  }
});
