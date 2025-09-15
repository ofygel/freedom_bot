import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import driverCommands from '../src/commands/driver';
import orderCommands from '../src/commands/order';
import {
  createOrder,
  updateOrderStatus,
  getOrder,
  updateOrder,
  expireAwaitingConfirm,
} from '../src/services/orders';
import { upsertCourier } from '../src/services/couriers';
import { createMockBot, sendUpdate } from './helpers';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  const invoices: { id: number; title: string }[] = [];
  const bot = createMockBot(messages, invoices);
  orderCommands(bot as any);
  driverCommands(bot as any);
  fs.rmSync(path.join(prev, 'data'), { recursive: true, force: true });
  return { dir, prev, bot, messages, invoices };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('receiver pay generates invoice and closes after confirmation', async () => {
  const { dir, prev, bot, messages, invoices } = setup();
  const prevToken = process.env.PROVIDER_TOKEN;
  process.env.PROVIDER_TOKEN = 'test';
  try {
    const order = createOrder({
      customer_id: 100,
      from: { lat: 43.2, lon: 76.9 },
      to: { lat: 43.25, lon: 76.95 },
      type: 'delivery',
      time: 'now',
      options: null,
      size: 'M',
      pay_type: 'receiver',
      comment: null,
      price: 10,
    });

    await sendUpdate(bot, {
      update_id: 0,
      callback_query: {
        id: '0',
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
      messages.at(-1)?.text.includes('Оплата: Получатель платит'),
    );

    updateOrderStatus(order.id, 'assigned', 200);
    updateOrderStatus(order.id, 'going_to_pickup', 200);
    updateOrderStatus(order.id, 'picked', 200);

    await sendUpdate(bot, {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 200, is_bot: false, first_name: 'C' },
        chat: { id: 200, type: 'private' },
        date: 0,
        text: 'В пути',
      } as any,
    });
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].id, 100);

    updateOrder(order.id, { payment_status: 'paid' });
    updateOrderStatus(order.id, 'at_dropoff', 200);

    await sendUpdate(bot, {
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 200, is_bot: false, first_name: 'C' },
        chat: { id: 200, type: 'private' },
        date: 0,
        text: 'Доставлено',
      } as any,
    });
    assert.equal(
      messages.at(-1)?.text,
      'Введите код от получателя или отправьте фото.'
    );

    await sendUpdate(bot, {
      update_id: 3,
      message: {
        message_id: 3,
        from: { id: 200, is_bot: false, first_name: 'C' },
        chat: { id: 200, type: 'private' },
        date: 0,
        photo: [{ file_id: 'file' }],
      } as any,
    });
    assert.equal(
      messages.at(-1)?.text,
      'Ожидайте оплату от получателя.'
    );
    assert.equal(invoices.length, 1);
    assert.equal(getOrder(order.id)?.status, 'awaiting_confirm');

    // no further courier actions emulated
  } finally {
    process.env.PROVIDER_TOKEN = prevToken;
    teardown(dir, prev);
  }
});

test('client sends card payment confirmation', async () => {
  const { dir, prev, bot, messages } = setup();
  try {
    upsertCourier({
      id: 200,
      transport: 'bike',
      fullName: 'C',
      idPhoto: '',
      selfie: '',
      card: '1234',
      status: 'verified',
    });
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
    updateOrderStatus(order.id, 'assigned', 200);
    assert.equal(
      messages.at(-1)?.text,
      'После оплаты нажмите «Оплатил(а)».',
    );

    await sendUpdate(bot, {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 100, is_bot: false, first_name: 'U' },
        chat: { id: 100, type: 'private' },
        date: 0,
        text: 'Оплатил(а)',
      } as any,
    });
    assert.equal(getOrder(order.id)?.payment_status, 'pending');
    assert.equal(
      messages.at(-1)?.text,
      'Отправьте скриншот или ID перевода.',
    );

    await sendUpdate(bot, {
      update_id: 2,
      message: {
        message_id: 2,
        from: { id: 100, is_bot: false, first_name: 'U' },
        chat: { id: 100, type: 'private' },
        date: 0,
        photo: [{ file_id: 'proof' }],
      } as any,
    });
    const stored = getOrder(order.id);
    assert.equal(stored?.status, 'awaiting_confirm');
    assert.equal(stored?.payment_proof, 'proof');
    assert.equal(
      messages.at(-1)?.text,
      'Спасибо! Ожидайте подтверждения.',
    );
  } finally {
    teardown(dir, prev);
  }
});

test('auto dispute after awaiting_confirm timeout', () => {
  const { dir, prev } = setup();
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
    updateOrderStatus(order.id, 'awaiting_confirm');
    const stored = getOrder(order.id)!;
    stored.transitions.find((t) => t.status === 'awaiting_confirm')!.at = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    updateOrder(order.id, { transitions: stored.transitions } as any);
    expireAwaitingConfirm();
    assert.ok(getOrder(order.id)?.dispute);
  } finally {
    teardown(dir, prev);
  }
});

