import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import type { Telegram } from 'telegraf';

import { notifyVerificationApproval, type VerificationApplication } from '../../src/bot/moderation/verifyQueue';
import * as bindings from '../../src/bot/channels/bindings';
import * as subscriptionsDb from '../../src/db/subscriptions';
import {
  TrialSubscriptionUnavailableError,
  type CreateTrialSubscriptionParams,
} from '../../src/db/subscriptions';
import { EXECUTOR_ORDERS_ACTION } from '../../src/bot/flows/executor/menu';

const createTelegram = () => {
  const sendMessage = mock.fn<
    (chatId: number, text: string, extra?: { reply_markup?: unknown }) => Promise<{ message_id: number }>
  >(async () => ({ message_id: 1 }));

  const telegram = {
    sendMessage: sendMessage as unknown as Telegram['sendMessage'],
  } as Telegram;

  return { telegram, sendMessage };
};

describe('notifyVerificationApproval', () => {
  const baseApplication: VerificationApplication = {
    id: 'verify-1',
    applicant: {
      telegramId: 777001,
      username: 'driver01',
      firstName: 'Ivan',
      lastName: 'Ivanov',
      phone: '+7 700 000 00 01',
    },
    role: 'driver',
  };

  let getChannelBindingMock: ReturnType<typeof mock.method> | undefined;
  let createTrialMock: ReturnType<typeof mock.method> | undefined;

  afterEach(() => {
    getChannelBindingMock?.mock.restore();
    getChannelBindingMock = undefined;
    createTrialMock?.mock.restore();
    createTrialMock = undefined;
  });

  it('activates the trial and announces the free period', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100500,
    }));

    const trialExpiresAt = new Date('2024-05-01T10:00:00Z');
    createTrialMock = mock.method(subscriptionsDb, 'createTrialSubscription', async () => ({
      subscriptionId: 12345,
      expiresAt: trialExpiresAt,
    }));

    const { telegram, sendMessage } = createTelegram();

    await notifyVerificationApproval(telegram, { ...baseApplication });

    assert.equal(createTrialMock.mock.callCount(), 1);
    const [trialCall] = createTrialMock.mock.calls;
    assert.ok(trialCall);
    const [trialArgs] = trialCall.arguments as [CreateTrialSubscriptionParams];
    assert.equal(trialArgs.trialDays, 2);

    assert.equal(sendMessage.mock.callCount(), 1);
    const [messageCall] = sendMessage.mock.calls;
    assert.ok(messageCall);
    const [chatId, text, extra] = messageCall.arguments;
    assert.equal(chatId, baseApplication.applicant.telegramId);
    assert.equal(typeof text, 'string');
    if (typeof text === 'string') {
      assert.ok(text.includes('бесплатный доступ на 2 дня'));
      assert.ok(text.includes('Доступ действует до'));
    }
    assert.ok(extra && typeof extra === 'object');
    if (extra && typeof extra === 'object') {
      assert.ok('reply_markup' in extra);
      const replyMarkup = extra.reply_markup as InlineKeyboardMarkup;
      assert.ok(replyMarkup?.inline_keyboard);
      const [row] = replyMarkup.inline_keyboard ?? [];
      assert.ok(row);
      const [button] = row;
      assert.ok(button);
      assert.equal(button.text, 'Заказы');
      if ('callback_data' in button) {
        assert.equal(button.callback_data, EXECUTOR_ORDERS_ACTION);
      } else {
        assert.fail('Expected callback button for trial activation');
      }
    }
  });

  it('prefers the trial notification over a custom approval payload', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100502,
    }));

    const trialExpiresAt = new Date('2024-05-02T15:00:00Z');
    createTrialMock = mock.method(subscriptionsDb, 'createTrialSubscription', async () => ({
      subscriptionId: 98765,
      expiresAt: trialExpiresAt,
    }));

    const { telegram, sendMessage } = createTelegram();

    await notifyVerificationApproval(telegram, {
      ...baseApplication,
      approvalNotification: {
        text: 'Custom approval message',
        keyboard: {
          inline_keyboard: [[{ text: 'Custom button', callback_data: 'custom:action' }]],
        },
      },
    });

    assert.equal(createTrialMock.mock.callCount(), 1);
    const [messageCall] = sendMessage.mock.calls;
    assert.ok(messageCall);
    const [, text, extra] = messageCall.arguments;
    assert.equal(typeof text, 'string');
    if (typeof text === 'string') {
      assert.ok(text.includes('бесплатный доступ на 2 дня'));
    }

    const replyMarkup = extra?.reply_markup as InlineKeyboardMarkup | undefined;
    assert.ok(replyMarkup?.inline_keyboard);
    const [row] = replyMarkup.inline_keyboard ?? [];
    assert.ok(row);
    const [button] = row;
    assert.ok(button);
    assert.equal(button.text, 'Заказы');
    if ('callback_data' in button) {
      assert.equal(button.callback_data, EXECUTOR_ORDERS_ACTION);
    } else {
      assert.fail('Expected callback button for trial activation');
    }
  });

  it('falls back to the paid subscription message when the trial fails', async () => {
    getChannelBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId: -100501,
    }));

    createTrialMock = mock.method(subscriptionsDb, 'createTrialSubscription', async () => {
      throw new TrialSubscriptionUnavailableError('already_used');
    });

    const { telegram, sendMessage } = createTelegram();

    await notifyVerificationApproval(telegram, { ...baseApplication });

    assert.equal(createTrialMock.mock.callCount(), 1);
    const [messageCall] = sendMessage.mock.calls;
    assert.ok(messageCall);
    const [, text, extra] = messageCall.arguments;
    assert.equal(typeof text, 'string');
    if (typeof text === 'string') {
      assert.ok(text.includes('оформите подписку'));
    }
    const replyMarkup = extra?.reply_markup as InlineKeyboardMarkup | undefined;
    assert.ok(replyMarkup?.inline_keyboard);
    const [row] = replyMarkup.inline_keyboard ?? [];
    assert.ok(row);
    const [button] = row;
    assert.ok(button);
    assert.equal(button.text, '📨 Получить ссылку на канал');
  });
});
