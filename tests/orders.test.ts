import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setOrdersBot,
  createOrder,
  updateOrderStatus,
  updateOrder,
  openDispute,
  addDisputeMessage,
  resolveDispute,
  reserveOrder,
  assignOrder,
  getOrder,
  expireReservations,
  expireMovementTimers,
  getOrderEvents,
} from '../src/services/orders';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orders-test-'));
  const prev = process.cwd();
  process.chdir(dir);
  const messages: { id: number; text: string }[] = [];
  setOrdersBot({
    telegram: {
      sendMessage: (id: number, text: string) => {
        messages.push({ id, text });
        return Promise.resolve();
      },
    },
  } as any);
  return { dir, prev, messages };
}

function teardown(dir: string, prev: string) {
  process.chdir(prev);
  fs.rmSync(dir, { recursive: true, force: true });
}

test('status update notifies client and courier', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    updateOrderStatus(order.id, 'assigned', 200);
    assert.deepEqual(messages, [
      { id: 100, text: 'Курьер назначен' },
      { id: 200, text: 'Заказ назначен' },
    ]);
  } finally {
    teardown(dir, prev);
  }
});

test('payment confirmation notifies both parties', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    updateOrderStatus(order.id, 'assigned', 200);
    messages.splice(0);
    updateOrder(order.id, { payment_status: 'paid' });
    assert.deepEqual(messages, [
      { id: 100, text: `Оплата заказа #${order.id} подтверждена` },
      { id: 200, text: `Оплата по заказу #${order.id} получена` },
    ]);
  } finally {
    teardown(dir, prev);
  }
});

test('dispute lifecycle notifies participants', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    updateOrderStatus(order.id, 'assigned', 200);
    messages.splice(0);

    openDispute(order.id);
    assert.deepEqual(messages, [
      { id: 100, text: `Открыт спор по заказу #${order.id}` },
      { id: 200, text: `Открыт спор по заказу #${order.id}` },
    ]);

    messages.splice(0);
    addDisputeMessage(order.id, 'client', 'привет');
    assert.deepEqual(messages, [
      { id: 200, text: 'Сообщение от клиента: привет' },
    ]);

    messages.splice(0);
    resolveDispute(order.id);
    assert.deepEqual(messages, [
      { id: 100, text: `Спор по заказу #${order.id} завершён` },
      { id: 200, text: `Спор по заказу #${order.id} завершён` },
    ]);
  } finally {
    teardown(dir, prev);
  }
});

test('expired reservations are released and notify users', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    reserveOrder(order.id, 200);
    updateOrder(order.id, {
      reserved_until: new Date(Date.now() - 1000).toISOString(),
    });
    messages.splice(0);
    expireReservations();
    const updated = getOrder(order.id)!;
    assert.equal(updated.status, 'open');
    assert.equal(updated.reserved_by, null);
    assert.equal(updated.reserved_until, null);
    assert.equal(updated.transitions.at(-1)?.status, 'open');
    assert.deepEqual(messages, [
      { id: 100, text: `Заказ #${order.id} возвращён в ленту` },
      { id: 200, text: `Бронь заказа #${order.id} истекла` },
    ]);
  } finally {
    teardown(dir, prev);
  }
});

test('inactive assigned order returns to open and notifies users', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    updateOrderStatus(order.id, 'assigned', 200);
    updateOrder(order.id, {
      movement_deadline: new Date(Date.now() - 1000).toISOString(),
    });
    messages.splice(0);
    expireMovementTimers();
    const updated = getOrder(order.id)!;
    assert.equal(updated.status, 'open');
    assert.equal(updated.courier_id, null);
    assert.equal(updated.movement_deadline, null);
    assert.deepEqual(messages, [
      { id: 100, text: `Заказ #${order.id} возвращён в ленту` },
      { id: 200, text: `Вы сняты с заказа #${order.id} из-за отсутствия движения` },
    ]);
  } finally {
    teardown(dir, prev);
  }
});

test('inactive delivery opens dispute and logs issue', () => {
  const { dir, prev, messages } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    updateOrderStatus(order.id, 'assigned', 200);
    updateOrderStatus(order.id, 'going_to_pickup');
    updateOrder(order.id, {
      movement_deadline: new Date(Date.now() - 1000).toISOString(),
    });
    messages.splice(0);
    expireMovementTimers();
    const updated = getOrder(order.id)!;
    assert.equal(updated.dispute?.status, 'open');
    assert.equal(updated.movement_deadline, null);
    assert.deepEqual(messages, [
      { id: 100, text: `Открыт спор по заказу #${order.id}` },
      { id: 200, text: `Открыт спор по заказу #${order.id}` },
    ]);
    const audit = fs
      .readFileSync('data/courier_audit.log', 'utf-8')
      .trim()
      .split('\n')
      .map(l => JSON.parse(l));
    assert.equal(audit.length, 1);
    assert.equal(audit[0].courier_id, 200);
    assert.equal(audit[0].type, 'no_movement');
  } finally {
    teardown(dir, prev);
  }
});

test('order events are logged', () => {
  const { dir, prev } = setup();
  try {
    const order = createOrder({
      customer_id: 100,
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
    reserveOrder(order.id, 200);
    assignOrder(order.id, 200);
    updateOrderStatus(order.id, 'delivered', 200);
    openDispute(order.id);
    addDisputeMessage(order.id, 'client', 'привет');
    resolveDispute(order.id);
    const events = getOrderEvents(order.id);
    assert.deepEqual(
      events.map(e => ({ event: e.event, actor_id: e.actor_id })),
      [
        { event: 'created', actor_id: 100 },
        { event: 'reserved', actor_id: 200 },
        { event: 'assigned', actor_id: 200 },
        { event: 'status_updated', actor_id: 200 },
        { event: 'dispute_opened', actor_id: null },
        { event: 'dispute_message', actor_id: 100 },
        { event: 'dispute_resolved', actor_id: null },
      ],
    );
  } finally {
    teardown(dir, prev);
  }
});
