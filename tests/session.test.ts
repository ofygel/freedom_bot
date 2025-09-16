import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { clearSession, session } from '../src/bot/middlewares/session';
import type { BotContext } from '../src/bot/types';

describe('session middleware', () => {
  it('resets session state to initial values after clearing', async () => {
    const middleware = session();
    const ctx = { chat: { id: 999, type: 'private' }, from: { id: 555 } } as unknown as BotContext;

    await middleware(ctx, async () => {
      ctx.session.isAuthenticated = true;
      ctx.session.phoneNumber = '+7 700 000 00 00';
      ctx.session.client.taxi.stage = 'collectingPickup';
      ctx.session.executor.subscription.status = 'awaitingReceipt';
      ctx.session.ui.steps['demo'] = { chatId: ctx.chat!.id!, messageId: 1, cleanup: true };
      ctx.session.ui.homeActions.push('home:demo');
    });

    assert.equal(ctx.session.isAuthenticated, true);
    assert.equal(ctx.session.client.taxi.stage, 'collectingPickup');
    assert.equal(ctx.session.executor.subscription.status, 'awaitingReceipt');
    assert.ok(ctx.session.ui.steps['demo']);
    assert.deepEqual(ctx.session.ui.homeActions, ['home:demo']);

    clearSession(ctx);

    const ctx2 = { chat: { id: 999, type: 'private' }, from: { id: 555 } } as unknown as BotContext;
    await middleware(ctx2, async () => {});

    assert.equal(ctx2.session.isAuthenticated, false);
    assert.equal(ctx2.session.client.taxi.stage, 'idle');
    assert.equal(ctx2.session.executor.subscription.status, 'idle');
    assert.deepEqual(ctx2.session.ui.steps, {});
    assert.deepEqual(ctx2.session.ui.homeActions, []);
    assert.notStrictEqual(ctx2.session, ctx.session);

    clearSession(ctx2);
  });
});
