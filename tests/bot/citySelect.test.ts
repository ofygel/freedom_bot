import '../helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';
import { mock } from 'node:test';
import type { Telegraf } from 'telegraf';

import type { BotContext } from '../../src/bot/types';
import { copy } from '../../src/bot/copy';

let registerCityAction: typeof import('../../src/bot/flows/common/citySelect')['registerCityAction'];
let usersService: typeof import('../../src/services/users');

before(async () => {
  ({ registerCityAction } = await import('../../src/bot/flows/common/citySelect'));
  usersService = await import('../../src/services/users');
});

describe('city selection flow', () => {
  it('answers with service unavailable toast when city persistence fails', async () => {
    const setUserCitySelectedMock = mock.method(
      usersService,
      'setUserCitySelected',
      async () => {
        throw new usersService.CitySelectionError('Failed to persist', new Error('db down'));
      },
    );

    const actions: Array<(ctx: BotContext, next?: () => Promise<void>) => Promise<void>> = [];
    const bot = {
      action: (_pattern: RegExp, handler: (ctx: BotContext, next?: () => Promise<void>) => Promise<void>) => {
        actions.push(handler);
        return bot;
      },
    } as unknown as Telegraf<BotContext>;

    registerCityAction(bot);

    assert.equal(actions.length, 1);

    const replies: string[] = [];
    let answered: { text?: string; options?: unknown } | undefined;
    let editMessageCalled = false;

    const ctx = {
      chat: { id: 111, type: 'private' as const, title: 'Test chat' },
      from: { id: 222, is_bot: false, first_name: 'Tester' },
      match: ['city:almaty', 'almaty'],
      session: {
        ephemeralMessages: [],
        isAuthenticated: true,
        awaitingPhone: false,
        executor: {
          role: 'courier',
          verification: {
            courier: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
            driver: { status: 'idle', requiredPhotos: 2, uploadedPhotos: [] },
          },
          subscription: { status: 'idle' },
        },
        client: {
          taxi: { stage: 'idle' },
          delivery: { stage: 'idle' },
        },
        ui: { steps: {}, homeActions: [] },
        support: { status: 'idle' },
      },
      auth: {
        user: {
          telegramId: 222,
          phoneVerified: false,
          role: 'courier',
          status: 'active_executor',
          isVerified: false,
          isBlocked: false,
        },
        executor: { verifiedRoles: { courier: false, driver: false }, hasActiveSubscription: false, isVerified: false },
        isModerator: false,
      },
      answerCbQuery: async (text?: string, options?: unknown) => {
        answered = { text, options };
        return true;
      },
      editMessageText: async () => {
        editMessageCalled = true;
        return true;
      },
      reply: async (text: string) => {
        replies.push(text);
        return {
          message_id: 1,
          chat: { id: 111, type: 'private' as const },
          date: Math.floor(Date.now() / 1000),
          text,
        };
      },
      telegram: {
        sendMessage: async (_chatId: number, text: string) => ({
          message_id: 2,
          chat: { id: 111, type: 'private' as const },
          date: Math.floor(Date.now() / 1000),
          text,
        }),
      },
      update: {} as never,
      updateType: 'callback_query' as const,
      botInfo: {} as never,
      state: {},
    } as unknown as BotContext & { match: RegExpExecArray };

    try {
      await actions[0](ctx);

      assert.equal(setUserCitySelectedMock.mock.callCount(), 1);
      assert.deepEqual(answered, { text: copy.serviceUnavailable, options: { show_alert: true } });
      assert.deepEqual(replies, ['Техническая ошибка, попробуйте позже']);
      assert.equal(editMessageCalled, false);
    } finally {
      setUserCitySelectedMock.mock.restore();
    }
  });
});
