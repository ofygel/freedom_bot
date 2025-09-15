import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import registerStart from '../src/commands/start';
import { getUser } from '../src/services/users';
import { createMockBot, sendUpdate } from './helpers';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'start-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  const bot = createMockBot(messages);
  registerStart(bot);
  return { dir, prev, bot, messages };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('phone collection and consent flow', async () => {
  const { dir, prev, bot, messages } = setup();
  try {
    await sendUpdate(bot, {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: '/start',
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
        text: 'Заказать доставку',
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 3,
      message: {
        message_id: 3,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        contact: { phone_number: '+777', first_name: 'A', user_id: 1 },
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 4,
      message: {
        message_id: 4,
        from: { id: 1, is_bot: false, first_name: 'A' },
        chat: { id: 1, type: 'private' },
        date: 0,
        text: 'Да',
      } as any,
    });
    const user = getUser(1)!;
    assert.equal(user.phone, '+777');
    assert.equal(user.role, 'client');
    assert.equal(user.consent, true);
    assert.deepEqual(
      messages.map((m) => m.text),
      [
        'Добро пожаловать! Выберите действие:',
        'Пожалуйста, отправьте ваш номер телефона.',
        'Согласны ли вы с условиями сервиса?',
        'Главное меню',
      ]
    );
  } finally {
    teardown(dir, prev);
  }
});
