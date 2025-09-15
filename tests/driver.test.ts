import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import driverCommands from '../src/commands/driver';
import { createOrder, getOrder } from '../src/services/orders';
import { setCourierOnline } from '../src/services/courierState';
import { createMockBot, sendUpdate } from './helpers';
import { markOrderChatDelivered } from '../src/services/chat';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'driver-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  const bot = createMockBot(messages);
  driverCommands(bot as any);
  return { dir, prev, bot, messages };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('reservation holds order for 90 seconds', async () => {
  const { dir, prev, bot, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
      from: { lat: 43.2, lon: 76.9 },
      to: { lat: 43.25, lon: 76.95 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'M',
      pay_type: 'cash',
      comment: null,
      price: 10,
    });
    setCourierOnline(200, true);
    const before = Date.now();
    await sendUpdate(bot, {
      update_id: 1,
      callback_query: {
        id: '1',
        from: { id: 200, is_bot: false, first_name: 'C' },
        message: {
          message_id: 10,
          text: 'card',
          chat: { id: -100, type: 'channel' },
        } as any,
        data: `reserve:${order.id}`,
      } as any,
    });
    const updated = getOrder(order.id)!;
    const diff = new Date(updated.reserved_until!).getTime() - before;
    assert.equal(updated.status, 'reserved');
    assert.equal(updated.reserved_by, 200);
    assert.ok(diff >= 89_000 && diff <= 91_000);
    assert.ok(
      messages.at(-1)?.text.includes(`Заказ #${order.id} зарезервирован`)
    );
  } finally {
    teardown(dir, prev);
  }
});

test('details include order options', async () => {
  const { dir, prev, bot, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
      from: { lat: 43.2, lon: 76.9 },
      to: { lat: 43.25, lon: 76.95 },
      type: 'delivery',
      time: 'now',
      options: 'Хрупкое, Термобокс',
      size: 'M',
      pay_type: 'cash',
      comment: null,
      price: 10,
    });
    await sendUpdate(bot, {
      update_id: 1,
      callback_query: {
        id: '1',
        from: { id: 200, is_bot: false, first_name: 'C' },
        message: {
          message_id: 10,
          text: 'card',
          chat: { id: -100, type: 'channel' },
        } as any,
        data: `details:${order.id}`,
      } as any,
    });
    assert.ok(
      messages.at(-1)?.text.includes('Опции: Хрупкое, Термобокс')
    );
  } finally {
    teardown(dir, prev);
  }
});

test('chat ttl set after delivery', async () => {
  const { dir, prev, bot } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
      from: { lat: 43.2, lon: 76.9 },
      to: { lat: 43.25, lon: 76.95 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'M',
      pay_type: 'card',
      comment: null,
      price: 10,
    });
    setCourierOnline(200, true);
    const user = { id: 200, is_bot: false, first_name: 'C' };
    const chat = { id: 200, type: 'private' };
    await sendUpdate(bot, {
      update_id: 1,
      callback_query: {
        id: '1',
        from: user,
        message: {
          message_id: 10,
          text: 'card',
          chat: { id: -100, type: 'channel' },
        } as any,
        data: `reserve:${order.id}`,
      } as any,
    });
    await sendUpdate(bot, {
      update_id: 2,
      callback_query: {
        id: '2',
        from: user,
        message: {
          message_id: 10,
          text: 'card',
          chat: { id: -100, type: 'channel' },
        } as any,
        data: `assign:${order.id}`,
      } as any,
    });
    markOrderChatDelivered(order.id);
    const raw = fs.readFileSync('data/order_chats.json', 'utf-8');
    const sessions = JSON.parse(raw);
    assert.equal(sessions.length, 1);
    const session = sessions[0];
    assert.equal(session.order_id, order.id);
    assert.ok(session.expires_at);
    const ttl = new Date(session.expires_at).getTime() - Date.now();
    assert.ok(ttl <= 86_400_000 && ttl > 86_000_000);
  } finally {
    teardown(dir, prev);
  }
});
