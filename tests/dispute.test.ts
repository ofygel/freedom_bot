import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setOrdersBot,
  createOrder,
  updateOrderStatus,
  openDispute,
  addDisputeMessage,
  resolveDispute,
  getOrder,
} from '../src/services/orders';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispute-test-'));
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

test('dispute open respond and resolve', async () => {
  const { dir, prev, messages } = setup();
  try {
    const order = await createOrder({
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
    await updateOrderStatus(order.id, 'assigned', 200);
    messages.splice(0);

    await openDispute(order.id);
    assert.deepEqual(messages, [
      { id: 100, text: `Открыт спор по заказу #${order.id}` },
      { id: 200, text: `Открыт спор по заказу #${order.id}` },
    ]);

    messages.splice(0);
    await addDisputeMessage(order.id, 'client', 'привет');
    assert.deepEqual(messages, [
      { id: 200, text: 'Сообщение от клиента: привет' },
    ]);

    messages.splice(0);
    await resolveDispute(order.id);
    assert.deepEqual(messages, [
      { id: 100, text: `Спор по заказу #${order.id} завершён` },
      { id: 200, text: `Спор по заказу #${order.id} завершён` },
    ]);

    const updated = await getOrder(order.id);
    if (!updated) throw new Error('Order not found');
    assert.equal(updated.dispute?.status, 'resolved');
  } finally {
    teardown(dir, prev);
  }
});

