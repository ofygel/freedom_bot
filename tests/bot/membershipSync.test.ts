import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Telegraf } from 'telegraf';
import type { ChatMemberUpdated } from 'telegraf/typings/core/types/typegram';

import { registerMembershipSync } from '../../src/bot/channels/membership';
import type { BotContext } from '../../src/bot/types';
import * as bindings from '../../src/bot/channels/bindings';
import * as subscriptions from '../../src/db/subscriptions';
import { logger } from '../../src/config';

const createChatMemberUpdate = (chatId: number, userId: number): ChatMemberUpdated =>
  ({
    chat: { id: chatId, type: 'supergroup', title: 'Drivers' },
    from: { id: 999, is_bot: false, first_name: 'Admin' },
    date: Math.floor(Date.now() / 1000),
    old_chat_member: {
      status: 'member',
      user: { id: userId, is_bot: false, first_name: 'Jane' },
    },
    new_chat_member: {
      status: 'left',
      user: { id: userId, is_bot: false, first_name: 'Jane' },
    },
  } as ChatMemberUpdated);

describe('registerMembershipSync', () => {
  it('marks active subscription as inactive when member leaves drivers chat', async () => {
    let handler:
      | ((ctx: BotContext & { chatMember?: ChatMemberUpdated }) => Promise<void>)
      | undefined;

    const bot = {
      on: mock.fn<(event: string, cb: typeof handler) => void>((event, cb) => {
        if (event === 'chat_member') {
          handler = cb as typeof handler;
        }
      }),
    } as unknown as Telegraf<BotContext>;

    const chatId = -100123;
    const userId = 555;
    const subscriptionId = 42;

    const getBindingMock = mock.method(bindings, 'getChannelBinding', async () => ({
      type: 'drivers',
      chatId,
    }));
    const findActiveMock = mock.method(
      subscriptions,
      'findActiveSubscriptionForUser',
      async () => ({
        id: subscriptionId,
        chatId,
        nextBillingAt: undefined,
        graceUntil: undefined,
        expiresAt: new Date(),
      }),
    );
    const markExpiredMock = mock.method(
      subscriptions,
      'markSubscriptionsExpired',
      async () => undefined,
    );
    const logWarnMock = mock.method(logger, 'warn', mock.fn());

    try {
      registerMembershipSync(bot);
      assert.ok(handler, 'chat_member handler should be registered');

      const update = createChatMemberUpdate(chatId, userId);
      await handler!({ chatMember: update } as BotContext & { chatMember: ChatMemberUpdated });

      assert.equal(getBindingMock.mock.callCount(), 1);
      assert.equal(findActiveMock.mock.callCount(), 1);
      const [findCall] = findActiveMock.mock.calls;
      assert.ok(findCall);
      assert.equal(findCall.arguments[0], chatId);
      assert.equal(findCall.arguments[1], userId);

      assert.equal(markExpiredMock.mock.callCount(), 1);
      const [markCall] = markExpiredMock.mock.calls;
      assert.ok(markCall);
      assert.deepEqual(markCall.arguments[0], [subscriptionId]);
      assert.ok(markCall.arguments[1] instanceof Date);

      assert.equal(logWarnMock.mock.callCount(), 1);
      const [logCall] = logWarnMock.mock.calls;
      assert.ok(logCall);
      assert.equal(logCall.arguments[1], 'Marked subscription inactive after membership downgrade');
    } finally {
      getBindingMock.mock.restore();
      findActiveMock.mock.restore();
      markExpiredMock.mock.restore();
      logWarnMock.mock.restore();
    }
  });
});
