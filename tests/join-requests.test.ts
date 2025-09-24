import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Telegraf, Telegram } from 'telegraf';
import type { ChatJoinRequest } from 'telegraf/typings/core/types/typegram';

import { registerJoinRequests, type SubscriptionChecker } from '../src/bot/channels/joinRequests';
import { EXECUTOR_SUBSCRIPTION_REQUIRED_MESSAGE } from '../src/bot/flows/executor/orders';
import type { BotContext } from '../src/bot/types';

describe('registerJoinRequests', () => {
  it('declines join request and notifies the user when subscription is expired', async () => {
    let joinRequestHandler:
      | ((ctx: BotContext & { chatJoinRequest?: ChatJoinRequest }) => Promise<void>)
      | undefined;

    const bot = {
      on: mock.fn<(event: string, handler: typeof joinRequestHandler) => void>(
        (event, handler) => {
          if (event === 'chat_join_request' && handler) {
            joinRequestHandler = handler as typeof joinRequestHandler;
          }
        },
      ),
    } as unknown as Telegraf<BotContext>;

    const hasActiveSubscription = mock.fn<SubscriptionChecker>(async () => false);

    registerJoinRequests(bot, { hasActiveSubscription });

    assert.ok(joinRequestHandler, 'chat join request handler should be registered');

    const declineChatJoinRequest = mock.fn<
      (chatId: number, userId: number) => Promise<true>
    >(async () => true as const);
    const sendMessage = mock.fn<
      (chatId: number, text: string) => Promise<{ message_id: number }>
    >(async () => ({ message_id: 42 }));

    const request: ChatJoinRequest = {
      chat: { id: -100123, type: 'supergroup', title: 'Drivers' },
      from: { id: 777, is_bot: false, first_name: 'Jane' },
      user_chat_id: 777,
      date: Math.floor(Date.now() / 1000),
    } as ChatJoinRequest;

    const ctx = {
      telegram: {
        declineChatJoinRequest: declineChatJoinRequest as unknown as Telegram['declineChatJoinRequest'],
        sendMessage: sendMessage as unknown as Telegram['sendMessage'],
      },
      chatJoinRequest: request,
    } as unknown as BotContext & { chatJoinRequest: ChatJoinRequest };

    await joinRequestHandler!(ctx);

    assert.equal(hasActiveSubscription.mock.callCount(), 1);
    const [subscriptionCall] = hasActiveSubscription.mock.calls;
    assert.ok(subscriptionCall);
    assert.equal(subscriptionCall.arguments[0], request.from.id);
    assert.equal(subscriptionCall.arguments[1], request.chat.id);

    assert.equal(declineChatJoinRequest.mock.callCount(), 1);
    const [declineCall] = declineChatJoinRequest.mock.calls;
    assert.ok(declineCall);
    assert.equal(declineCall.arguments[0], request.chat.id);
    assert.equal(declineCall.arguments[1], request.from.id);

    assert.equal(sendMessage.mock.callCount(), 1);
    const [notifyCall] = sendMessage.mock.calls;
    assert.ok(notifyCall);
    assert.equal(notifyCall.arguments[0], request.from.id);
    assert.equal(notifyCall.arguments[1], EXECUTOR_SUBSCRIPTION_REQUIRED_MESSAGE);
  });
});
