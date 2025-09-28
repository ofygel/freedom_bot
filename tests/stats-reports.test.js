const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node/register/transpile-only');

const ensureEnv = (key, value) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
};

process.env.NODE_ENV = 'test';
ensureEnv('BOT_TOKEN', 'test-bot-token');
ensureEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
ensureEnv('KASPI_CARD', '0000 0000 0000 0000');
ensureEnv('KASPI_NAME', 'Test User');
ensureEnv('KASPI_PHONE', '+70000000000');
ensureEnv('WEBHOOK_DOMAIN', 'example.com');
ensureEnv('WEBHOOK_SECRET', 'secret');
ensureEnv('FEATURE_REPORTS_ENABLED', 'true');

const { pool } = require('../src/db');
pool.query = async () => ({ rows: [] });

const bindings = require('../src/bot/channels/bindings');
bindings.getChannelBinding = async () => ({ type: 'stats', chatId: 777 });

const createTelegramMock = () => {
  const calls = [];
  return {
    calls,
    sendMessage: async (chatId, text) => {
      calls.push({ chatId, text });
      return { message_id: calls.length };
    },
  };
};

test('savePhone sends phone verified report to stats channel', async () => {
  const { savePhone } = require('../src/bot/flows/common/phoneCollect');

  const telegram = createTelegramMock();
  const ctx = {
    chat: { type: 'private', id: 101 },
    from: { id: 42, username: 'user', first_name: 'Test', last_name: 'User' },
    message: { contact: { phone_number: '+7 701 1234567', user_id: 42 } },
    auth: {
      user: {
        telegramId: 42,
        username: 'user',
        firstName: 'Test',
        lastName: 'User',
        phoneVerified: false,
        status: 'awaiting_phone',
        role: 'guest',
        executorKind: undefined,
        phone: undefined,
        citySelected: undefined,
      },
      executor: {
        hasActiveSubscription: false,
        isVerified: false,
        verifiedRoles: { courier: false, driver: false },
      },
      isModerator: false,
    },
    session: {
      awaitingPhone: true,
      phoneNumber: undefined,
      user: { id: 42, phoneVerified: false },
      executor: undefined,
      client: undefined,
      ui: {},
      ephemeralMessages: [],
    },
    state: {},
    telegram,
  };

  await savePhone(ctx, async () => {});

  assert.ok(
    telegram.calls.some((call) => call.text.includes('PHONE_VERIFIED')),
    'expected PHONE_VERIFIED report',
  );
  assert.ok(
    telegram.calls.every((call) => call.chatId === 777),
    'reports should target stats chat',
  );
});

test('applyClientRole sends role change report to stats channel', async () => {
  const usersDb = require('../src/db/users');
  usersDb.ensureClientRole = async () => {};

  const { applyClientRole } = require('../src/bot/flows/client/menu');

  const telegram = createTelegramMock();
  const ctx = {
    chat: { type: 'private', id: 202 },
    from: { id: 84, username: 'client', first_name: 'Client', last_name: 'User' },
    auth: {
      user: {
        telegramId: 84,
        username: 'client',
        firstName: 'Client',
        lastName: 'User',
        phone: '+77010000000',
        phoneVerified: true,
        status: 'active_client',
        role: 'guest',
        executorKind: 'courier',
        citySelected: 'almaty',
      },
      executor: {
        hasActiveSubscription: false,
        isVerified: false,
        verifiedRoles: { courier: false, driver: false },
      },
      isModerator: false,
    },
    session: {
      phoneNumber: '+77010000000',
      user: { id: 84, phoneVerified: false },
      isAuthenticated: false,
      executor: undefined,
      client: undefined,
      ui: {},
    },
    telegram,
  };

  await applyClientRole(ctx);

  assert.ok(
    telegram.calls.some((call) => call.text.includes('ROLE_SET')),
    'expected ROLE_SET report',
  );
  assert.ok(telegram.calls.every((call) => call.chatId === 777));
});

test('handleRoleSelection sends executor role change report', async () => {
  const usersDb = require('../src/db/users');
  usersDb.updateUserRole = async () => {};

  const commands = require('../src/bot/services/commands');
  commands.setChatCommands = async () => {};

  const clientMenu = require('../src/ui/clientMenu');
  clientMenu.hideClientMenu = async () => {};

  const citySelect = require('../src/bot/flows/common/citySelect');
  citySelect.askCity = async () => {};

  const botUi = require('../src/bot/ui');
  botUi.ui.trackStep = async () => {};

  const { handleRoleSelection } = require('../src/bot/flows/executor/roleSelect');

  const telegram = createTelegramMock();
  const ctx = {
    chat: { type: 'private', id: 303 },
    from: { id: 96, username: 'exec', first_name: 'Exec', last_name: 'User' },
    auth: {
      user: {
        telegramId: 96,
        username: 'exec',
        firstName: 'Exec',
        lastName: 'User',
        phone: '+77020000000',
        phoneVerified: true,
        status: 'guest',
        role: 'guest',
        executorKind: undefined,
        citySelected: 'almaty',
      },
      executor: {
        hasActiveSubscription: false,
        isVerified: false,
        verifiedRoles: { courier: false, driver: false },
      },
      isModerator: false,
    },
    session: {
      isAuthenticated: true,
      phoneNumber: '+77020000000',
      executor: undefined,
      client: undefined,
      ui: { pendingCityAction: undefined },
      ephemeralMessages: [],
    },
    telegram,
    answerCbQuery: async () => {},
    deleteMessage: async () => {},
    editMessageReplyMarkup: async () => {},
  };

  await handleRoleSelection(ctx, 'courier');

  assert.ok(
    telegram.calls.some((call) => call.text.includes('ROLE_SET')),
    'expected ROLE_SET report for executor',
  );
  assert.ok(telegram.calls.every((call) => call.chatId === 777));
});

test('sendCitySelectionReport delivers city event to stats channel', async () => {
  const { sendCitySelectionReport } = require('../src/bot/flows/common/citySelect');

  const telegram = createTelegramMock();
  const ctx = {
    auth: {
      user: {
        telegramId: 123,
        username: 'cityuser',
        firstName: 'City',
        lastName: 'User',
        phone: '+77030000000',
        role: 'client',
        executorKind: 'courier',
        citySelected: 'almaty',
      },
      executor: {
        hasActiveSubscription: false,
        isVerified: false,
        verifiedRoles: { courier: false, driver: false },
      },
      isModerator: false,
    },
    session: {
      phoneNumber: '+77030000000',
      ui: { pendingCityAction: 'clientMenu' },
    },
    telegram,
    from: { id: 123, username: 'cityuser', first_name: 'City', last_name: 'User' },
  };

  await sendCitySelectionReport(ctx, 'astana', 'almaty');

  assert.ok(
    telegram.calls.some((call) => call.text.includes('CITY_SET')),
    'expected CITY_SET report',
  );
  assert.ok(telegram.calls.every((call) => call.chatId === 777));
});
