import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Telegram } from 'telegraf';

import * as bindings from '../src/bot/channels/bindings';
import {
  buildOrderChannelMessage,
  buildOrderDetailsMessage,
  handleClientOrderCancellation,
} from '../src/bot/channels/ordersChannel';
import { estimateEtaMinutes } from '../src/services/pricing';
import type { OrderWithExecutor } from '../src/types';

const createOrderRecord = (overrides: Partial<OrderWithExecutor> = {}): OrderWithExecutor => ({
  id: 101,
  shortId: 'A1B2',
  kind: 'taxi',
  status: 'cancelled',
  city: 'almaty',
  clientId: 555,
  pickup: {
    query: 'start',
    address: 'Start address',
    latitude: 43.2,
    longitude: 76.9,
  },
  dropoff: {
    query: 'end',
    address: 'End address',
    latitude: 43.3,
    longitude: 76.95,
  },
  price: {
    amount: 1500,
    currency: 'KZT',
    distanceKm: 5.2,
    etaMinutes: estimateEtaMinutes(5.2),
  },
  createdAt: new Date('2024-01-01T00:00:00Z'),
  ...overrides,
});

describe('handleClientOrderCancellation', () => {
  let getChannelBindingMock: ReturnType<typeof mock.method> | undefined;

  afterEach(() => {
    getChannelBindingMock?.mock.restore();
    getChannelBindingMock = undefined;
  });

  const createTelegram = () => {
    const deleteMessage = mock.fn<
      (chatId: string | number, messageId: number) => Promise<true>
    >(async () => true as const);
    const sendMessage = mock.fn<
      (chatId: string | number, text: string, extra?: unknown) => Promise<{ message_id: number }>
    >(async () => ({ message_id: 1 }));

    const telegram = {
      deleteMessage: deleteMessage as unknown as Telegram['deleteMessage'],
      sendMessage: sendMessage as unknown as Telegram['sendMessage'],
    } as Telegram;

    return { telegram, deleteMessage, sendMessage };
  };

  it('removes the drivers channel message for open orders without notifying executors', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100123,
    }));

    const { telegram, deleteMessage, sendMessage } = createTelegram();
    const order = createOrderRecord({ channelMessageId: 2001 });

    await handleClientOrderCancellation(telegram, order);

    assert.equal(deleteMessage.mock.callCount(), 1);
    const [deleteCall] = deleteMessage.mock.calls;
    assert.ok(deleteCall);
    const [deleteChatId, deleteMessageId] = deleteCall.arguments;
    assert.equal(deleteChatId, -100123);
    assert.equal(deleteMessageId, 2001);
    assert.equal(sendMessage.mock.callCount(), 0);
  });

  it('notifies a claimed executor when cancelling the order', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100555,
    }));

    const { telegram, deleteMessage, sendMessage } = createTelegram();
    const order = createOrderRecord({
      channelMessageId: 3002,
      claimedBy: 777,
      executor: {
        telegramId: 888,
        username: 'executor88',
        firstName: 'Alex',
        lastName: 'Courier',
      },
    });

    await handleClientOrderCancellation(telegram, order);

    assert.equal(deleteMessage.mock.callCount(), 1);
    assert.equal(sendMessage.mock.callCount(), 1);
    const [notifyCall] = sendMessage.mock.calls;
    assert.ok(notifyCall);
    const [notifyChatId, messageText] = notifyCall.arguments;
    assert.equal(notifyChatId, 888);
    assert.equal(typeof messageText, 'string');
    if (typeof messageText === 'string') {
      assert.ok(messageText.includes('Заказ отменён клиентом'));
      assert.ok(messageText.includes(order.shortId));
    }
  });
});

describe('order message formatting', () => {
  const baseOrder = createOrderRecord({
    kind: 'delivery',
    clientPhone: '+77001234567',
    recipientPhone: '+77007654321',
    isPrivateHouse: false,
    apartment: '12Б',
    entrance: '3',
    floor: '5',
    clientComment: 'Позвонить получателю за 10 минут.',
  });

  it('includes recipient details for executors', () => {
    const message = buildOrderDetailsMessage(baseOrder);
    assert.ok(message.includes('Телефон клиента: +77001234567'));
    assert.ok(message.includes('Телефон получателя: +77007654321'));
    assert.ok(message.includes('Тип адреса: Многоквартирный дом'));
    assert.ok(message.includes('Квартира: 12Б'));
    assert.ok(message.includes('Подъезд: 3'));
    assert.ok(message.includes('Этаж: 5'));
  });

  it('keeps pii hidden in the public channel message', () => {
    const message = buildOrderChannelMessage(baseOrder);
    assert.ok(!message.includes('Телефон клиента'));
    assert.ok(!message.includes('Телефон получателя'));
    assert.ok(!message.includes('Квартира'));
    assert.ok(!message.includes('Подъезд'));
    assert.ok(!message.includes('Этаж'));
  });
});

