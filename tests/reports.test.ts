import './helpers/setup-env';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { pool } from '../src/db';
import type { AppCity } from '../src/domain/cities';
import type { OrderRecord } from '../src/types';
import type { Telegram } from 'telegraf';
import type { UserIdentity } from '../src/bot/services/reports';

const originalQuery = pool.query.bind(pool);

const setPoolQuery = (
  fn: (...args: Parameters<typeof pool.query>) => ReturnType<typeof pool.query>,
): void => {
  (pool as unknown as { query: typeof fn }).query = fn;
};

const clearModule = (specifier: string): void => {
  try {
    const resolved = require.resolve(specifier);
    delete require.cache[resolved];
  } catch {
    // Ignore missing modules in cache.
  }
};

const loadReportsModule = async () => {
  clearModule('../src/config/env');
  clearModule('../src/config/index');
  clearModule('../src/config');
  clearModule('../src/bot/services/reports');
  return import('../src/bot/services/reports');
};

const createTelegramStub = () => {
  let lastMessage: { chatId: number; text: string } | undefined;
  const telegram: Partial<Telegram> = {
    sendMessage: async (chatId: number, text: string) => {
      lastMessage = { chatId, text };
      return { message_id: 1 } as any;
    },
  };

  return { telegram: telegram as Telegram, getLastMessage: () => lastMessage };
};

let originalFlag: string | undefined;

beforeEach(() => {
  originalFlag = process.env.FEATURE_REPORTS_ENABLED;
});

afterEach(() => {
  process.env.FEATURE_REPORTS_ENABLED = originalFlag;
  setPoolQuery(originalQuery);
});

describe('reports service', () => {
  it('skips sending when reports are disabled', async () => {
    process.env.FEATURE_REPORTS_ENABLED = '0';
    const reports = await loadReportsModule();
    const { telegram, getLastMessage } = createTelegramStub();

    const result = await reports.sendStatsReport(telegram, 'test message');

    assert.equal(result.status, 'disabled');
    assert.equal(getLastMessage(), undefined);
  });

  it('handles missing stats channel gracefully', async () => {
    process.env.FEATURE_REPORTS_ENABLED = '1';
    setPoolQuery(async () => ({
      rows: [
        {
          verify_channel_id: null,
          drivers_channel_id: null,
          stats_channel_id: null,
        },
      ],
    }) as any);
    const reports = await loadReportsModule();
    const { telegram, getLastMessage } = createTelegramStub();

    const result = await reports.sendStatsReport(telegram, 'another test');

    assert.equal(result.status, 'missing_channel');
    assert.equal(getLastMessage(), undefined);
  });

  it('sends formatted order reports when channel is configured', async () => {
    process.env.FEATURE_REPORTS_ENABLED = '1';
    setPoolQuery(async () => ({
      rows: [
        {
          verify_channel_id: null,
          drivers_channel_id: null,
          stats_channel_id: '-100200300',
        },
      ],
    }) as any);
    const reports = await loadReportsModule();
    const { telegram, getLastMessage } = createTelegramStub();

    const order: OrderRecord = {
      id: 42,
      shortId: 'AB12',
      kind: 'delivery',
      status: 'open',
      city: 'almaty' as AppCity,
      clientId: 1001,
      clientPhone: '+77010000000',
      recipientPhone: '+77012223344',
      customerName: 'Иван',
      customerUsername: 'ivan',
      clientComment: 'Осторожно, стекло',
      pickup: {
        query: 'Point A',
        address: 'Алматы, пр. Абая 1',
        latitude: 43.2407,
        longitude: 76.8896,
      },
      dropoff: {
        query: 'Point B',
        address: 'Алматы, ул. Достык 10',
        latitude: 43.2365,
        longitude: 76.9456,
      },
      price: {
        amount: 1500,
        currency: 'KZT',
        distanceKm: 5.2,
        etaMinutes: 18,
      },
      channelMessageId: undefined,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      claimedBy: undefined,
      claimedAt: undefined,
      completedAt: undefined,
      entrance: undefined,
      apartment: undefined,
      floor: undefined,
      isPrivateHouse: false,
    } as OrderRecord;

    const customer: UserIdentity = {
      telegramId: 1001,
      username: 'ivan',
      firstName: 'Иван',
      lastName: 'Иванов',
      phone: '+77010000000',
    };

    const result = await reports.reportOrderCreated(telegram, {
      order,
      customer,
      publishStatus: 'published',
    });

    assert.equal(result.status, 'sent');
    const sent = getLastMessage();
    assert.ok(sent, 'report should be sent');
    assert.equal(sent?.chatId, -100200300);
    assert.match(sent?.text ?? '', /Заказ/);
    assert.match(sent?.text ?? '', /Алматы/);
    assert.match(sent?.text ?? '', /1[\u00a0\s]?500/);
  });
});
