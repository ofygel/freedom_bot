import './helpers/setup-env';

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

let geocodeAddress: typeof import('../src/bot/services/geocoding')['geocodeAddress'];

const firmUrl = 'https://2gis.kz/almaty/firm/70000001078895647';

const originalEnv: Record<string, string | undefined> = {};
const setEnv = (key: string, value: string) => {
  if (!(key in originalEnv)) {
    originalEnv[key] = process.env[key];
  }

  process.env[key] = value;
};

let originalFetch: typeof globalThis.fetch;

describe('geocoding 2ГИС firm links', () => {
  const installSuccessfulFetchMock = (seenUrls: string[], onRequest?: (url: URL) => void): void => {
    globalThis.fetch = async (input: unknown): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
          ? input
          : new URL((input as Request).url);

      seenUrls.push(url.toString());
      onRequest?.(url);

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

      if (url.pathname.includes('/items/geocode')) {
        const body = JSON.stringify({
          result: {
            items: [
              {
                point: { lat: '49.804688', lon: '73.109382' },
                full_name: 'Караганда, проспект Абая 10',
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
  };

  const expectTwoGisResolution = async (query: string, expectedQuery: string): Promise<void> => {
    const seenUrls: string[] = [];
    installSuccessfulFetchMock(seenUrls);

    const result = await geocodeAddress(query);

    assert.ok(result, `expected geocodeAddress to resolve link via 2ГИС for ${query}`);
    assert.equal(result?.query, expectedQuery);
    assert.equal(result?.latitude, 43.238949);
    assert.equal(result?.longitude, 76.889709);
    assert.equal(result?.address, 'Алматы, проспект Абая 10');
    assert.equal(result?.twoGisUrl, firmUrl);

    assert.ok(
      seenUrls.some((value) => value.includes('/items/byid')),
      'expected a 2ГИС lookup request',
    );
  };

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
    await expectTwoGisResolution(firmUrl, firmUrl);
  });

  it('resolves firm links that follow descriptive text', async () => {
    const query = `Barfly ${firmUrl}`;
    await expectTwoGisResolution(query, `Barfly ${firmUrl}`);
  });

  it('resolves firm links found in multiline descriptions', async () => {
    const query = `Barfly\n${firmUrl}`;
    await expectTwoGisResolution(query, `Barfly ${firmUrl}`);
  });

  it('resolves firm links with trailing punctuation', async () => {
    const query = `${firmUrl},`;
    await expectTwoGisResolution(query, `${firmUrl}, `);
  });

  it('normalizes map links to canonical geo URLs', async () => {
    globalThis.fetch = async (input: unknown): Promise<Response> => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
          ? input
          : new URL((input as Request).url);

      assert.equal(url.hostname, 'nominatim.test');
      assert.equal(url.pathname, '/reverse');
      assert.equal(Number(url.searchParams.get('lat')), 43.23979);
      assert.equal(Number(url.searchParams.get('lon')), 76.914014);

      const body = JSON.stringify({ display_name: 'Test address' });
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const mapUrl =
      'https://2gis.kz/almaty?m=76.914014,43.239790/18&q=52/1,%20%D0%90%D0%B1%D0%B0%D0%B9%20%D0%B4%D0%B0%D2%A3%D2%93%D1%8B%D0%BB%D1%8B';
    const result = await geocodeAddress(`Ресторан ${mapUrl}`);

    assert.ok(result, 'expected map link to resolve');
    assert.equal(result?.latitude, 43.23979);
    assert.equal(result?.longitude, 76.914014);
    assert.equal(result?.address, 'Test address');
    assert.equal(result?.twoGisUrl, 'https://2gis.kz/almaty/geo/0/76.914014,43.23979');
  });

  it('includes selected city when resolving manual addresses', async () => {
    const seenUrls: string[] = [];
    installSuccessfulFetchMock(seenUrls, (url) => {
      if (url.pathname.includes('/items/geocode')) {
        assert.equal(url.searchParams.get('q'), 'Караганда, Проспект Абая 10');
      }
    });

    const result = await geocodeAddress('Проспект Абая 10', { cityName: 'Караганда' });

    assert.ok(result, 'expected geocodeAddress to resolve manual address in selected city');
    assert.equal(result?.query, 'Проспект Абая 10');
    assert.equal(result?.latitude, 49.804688);
    assert.equal(result?.longitude, 73.109382);
    assert.equal(result?.address, 'Караганда, проспект Абая 10');
    assert.equal(result?.twoGisUrl, undefined);
  });
});
