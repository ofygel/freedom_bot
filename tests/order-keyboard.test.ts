import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildOrderLocationsKeyboard } from '../src/bot/keyboards/orders';
import type { OrderLocation } from '../src/types';

const createLocation = (overrides: Partial<OrderLocation> = {}): OrderLocation => ({
  query: 'Test query',
  address: 'Test address',
  latitude: 43.238949,
  longitude: 76.889709,
  ...overrides,
});

describe('buildOrderLocationsKeyboard', () => {
  it('preserves original 2ГИС links for pickup and dropoff locations', () => {
    const pickupUrl = 'https://2gis.kz/almaty/geo/9430150454181985/76.872716,43.239382';
    const dropoffUrl = 'https://2gis.kz/almaty/geo/9430150454181985/76.892716,43.229382';

    const pickup = createLocation({ twoGisUrl: pickupUrl });
    const dropoff = createLocation({ twoGisUrl: dropoffUrl });

    const keyboard = buildOrderLocationsKeyboard('almaty', pickup, dropoff);

    const [firstRow, secondRow] = keyboard.inline_keyboard ?? [];
    assert.ok(firstRow, 'expected pickup/dropoff row to be present');
    assert.ok(secondRow, 'expected route row to be present');

    const [pickupButton, dropoffButton] = firstRow;
    assert.ok(pickupButton && 'url' in pickupButton, 'expected pickup button with URL');
    assert.ok(dropoffButton && 'url' in dropoffButton, 'expected dropoff button with URL');

    assert.equal(pickupButton.url, pickupUrl);
    assert.equal(dropoffButton.url, dropoffUrl);
  });
});
