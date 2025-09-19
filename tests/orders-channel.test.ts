import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import type { Telegram } from 'telegraf';

import * as bindings from '../src/bot/channels/bindings';
import { handleClientOrderCancellation } from '../src/bot/channels/ordersChannel';
import { estimateEtaMinutes } from '../src/services/pricing';
import type { OrderWithExecutor } from '../src/types';

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

  const createOrder = (overrides: Partial<OrderWithExecutor> = {}): OrderWithExecutor => ({
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

  it('removes the drivers channel message for open orders without notifying executors', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100123,
    }));

    const { telegram, deleteMessage, sendMessage } = createTelegram();
    const order = createOrder({ channelMessageId: 2001 });

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
    const order = createOrder({
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

