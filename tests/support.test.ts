import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTicket, getTicket } from '../src/services/tickets';
import supportCommands from '../src/commands/support';
import { createOrder } from '../src/services/orders';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'support-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  return { dir, prev };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('create ticket with text', () => {
  const { dir, prev } = setup();
  try {
    const ticket = createTicket({
      order_id: 1,
      user_id: 1,
      topic: 'topic',
      text: 'hello',
    });
    assert.equal(ticket.text, 'hello');
    const saved = getTicket(ticket.id)!;
    assert.equal(saved.text, 'hello');
  } finally {
    teardown(dir, prev);
  }
});

test('create ticket with photo', () => {
  const { dir, prev } = setup();
  try {
    const ticket = createTicket({
      order_id: 1,
      user_id: 1,
      topic: 'topic',
      photo: 'file_id',
    });
    assert.equal(ticket.photo, 'file_id');
    const saved = getTicket(ticket.id)!;
    assert.equal(saved.photo, 'file_id');
  } finally {
    teardown(dir, prev);
  }
});

test('support wizard lists client orders', async () => {
  const { dir, prev } = setup();
  try {
    const order1 = await createOrder({
      customer_id: 1,
      from: { lat: 0, lon: 0 },
      to: { lat: 1, lon: 1 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'S',
      pay_type: 'cash',
      comment: null,
      price: 10,
    });
    const order2 = await createOrder({
      customer_id: 1,
      from: { lat: 0, lon: 0 },
      to: { lat: 1, lon: 1 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'S',
      pay_type: 'cash',
      comment: null,
      price: 10,
    });
    await createOrder({
      customer_id: 2,
      from: { lat: 0, lon: 0 },
      to: { lat: 1, lon: 1 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'S',
      pay_type: 'cash',
      comment: null,
      price: 10,
    });

    const handlers: Record<string, any> = {};
    const bot = {
      hears: (trigger: any, fn: any) => {
        handlers[trigger] = fn;
      },
      on: () => {},
      command: () => {},
    } as any;
    supportCommands(bot);

    let replyText: string | undefined;
    let keyboard: any;
    await handlers['Поддержка']({
      from: { id: 1 },
      chat: { id: 1 },
      reply: (text: string, extra: any) => {
        replyText = text;
        keyboard = extra?.reply_markup?.keyboard;
        return Promise.resolve({ message_id: 1 });
      },
      telegram: { deleteMessage: () => Promise.resolve() },
    });

    assert.equal(replyText, 'Выберите номер заказа:');
    assert.deepEqual(keyboard, [[String(order1.id)], [String(order2.id)], ['Отмена']]);
  } finally {
    teardown(dir, prev);
  }
});
