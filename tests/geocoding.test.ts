import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

let geocodeAddress: typeof import('../src/bot/services/geocoding')['geocodeAddress'];

const originalEnv: Record<string, string | undefined> = {};
const setEnv = (key: string, value: string) => {
  if (!(key in originalEnv)) {
    originalEnv[key] = process.env[key];
  }

  process.env[key] = value;
};

let originalFetch: typeof globalThis.fetch;

describe('geocoding 2ГИС firm links', () => {
  before(async () => {
    setEnv('BOT_TOKEN', 'test-token');
    setEnv('DATABASE_URL', 'postgres://user:pass@localhost:5432/db');
    setEnv('KASPI_CARD', '4400 0000 0000 0000');
    setEnv('KASPI_NAME', 'Freedom Bot');
    setEnv('KASPI_PHONE', '+7 (700) 000-00-00');
    setEnv('TWOGIS_API_KEY', 'test-key');
    setEnv('NOMINATIM_REVERSE_URL', 'https://nominatim.test/reverse');
    setEnv('CITY_DEFAULT', 'Алматы');

    ({ geocodeAddress } = await import('../src/bot/services/geocoding'));
  });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  after(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === 'undefined') {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('resolves firm links without embedded coordinates', async () => {
    const seenUrls: string[] = [];

    globalThis.fetch = async (input: unknown): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
          ? input
          : new URL((input as Request).url);

      seenUrls.push(url.toString());

      if (url.pathname.includes('/items/byid')) {
        const body = JSON.stringify({
          result: {
            items: [
              {
                point: { lat: '43.238949', lon: '76.889709' },
                full_name: 'Test Place, Алматы',
              },
            ],
          },
        });

        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.hostname === 'nominatim.test') {
        assert.equal(url.searchParams.get('lat'), '43.238949');
        assert.equal(url.searchParams.get('lon'), '76.889709');

        const body = JSON.stringify({ display_name: 'Алматы, проспект Абая 10' });
        return new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch call for ${url.toString()}`);
    };

    const firmUrl = 'https://2gis.kz/almaty/firm/70000001078895647';
    const result = await geocodeAddress(firmUrl);

    assert.ok(result, 'expected geocodeAddress to resolve link via 2ГИС');
    assert.equal(result?.query, firmUrl);
    assert.equal(result?.latitude, 43.238949);
    assert.equal(result?.longitude, 76.889709);
    assert.equal(result?.address, 'Алматы, проспект Абая 10');

    assert.ok(
      seenUrls.some((value) => value.includes('/items/byid')),
      'expected a 2ГИС lookup request',
    );
  });
});
