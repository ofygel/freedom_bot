import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import registerOrder from '../src/commands/order';
import { createMockBot, sendUpdate } from './helpers';
import { updateSetting } from '../src/services/settings';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'order-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  const bot = createMockBot(messages);
  registerOrder(bot);
  updateSetting('order_hours_start', 0);
  updateSetting('order_hours_end', 24);
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
        text: 'Документы',
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

test('order summary shows selected options', async () => {
  const { dir, prev, bot, messages } = setup();
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    json: async () => ({ display_name: 'addr' }),
  }) as any;
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
        text: 'Документы',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 3,
      message: {
        message_id: 3,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        location: { latitude: 43.25, longitude: 76.95 },
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 4,
      message: {
        message_id: 4,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        location: { latitude: 43.26, longitude: 76.96 },
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 5,
      message: {
        message_id: 5,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: 'Сейчас',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 6,
      callback_query: {
        id: 'a',
        from: { id: 1, is_bot: false, first_name: 'A' },
        message: { message_id: 6, chat: { id: 1, type: 'private' } } as any,
        data: 'size:M',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 7,
      callback_query: {
        id: 'b',
        from: { id: 1, is_bot: false, first_name: 'A' },
        message: { message_id: 6, chat: { id: 1, type: 'private' } } as any,
        data: 'opt:Термобокс',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 8,
      callback_query: {
        id: 'c',
        from: { id: 1, is_bot: false, first_name: 'A' },
        message: { message_id: 6, chat: { id: 1, type: 'private' } } as any,
        data: 'opt:Нужна сдача',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 9,
      callback_query: {
        id: 'd',
        from: { id: 1, is_bot: false, first_name: 'A' },
        message: { message_id: 6, chat: { id: 1, type: 'private' } } as any,
        data: 'dims:done',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 10,
      message: {
        message_id: 7,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: 'Наличные',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 11,
      message: {
        message_id: 8,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: 'нет',
      } as any,
    });
    const summary = messages.find((m) => m.text.includes('Опции:'));
    assert.ok(summary?.text.includes('Термобокс, Нужна сдача'));
  } finally {
    global.fetch = originalFetch;
    teardown(dir, prev);
  }
});
