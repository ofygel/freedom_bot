import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PricingConfig, TariffConfig } from '../src/config';
import type { OrderLocation } from '../src/types';

const computeExpectedAmount = (distanceKm: number, tariff: TariffConfig): number => {
  const raw = tariff.baseFare + distanceKm * tariff.perKm;
  const rounded = Math.round(raw / 10) * 10;
  return Math.max(tariff.minimumFare, rounded);
};

const from: OrderLocation = {
  query: 'Abay Avenue 1',
  address: 'Abay Avenue 1, Almaty',
  latitude: 43.238949,
  longitude: 76.889709,
};
const to: OrderLocation = {
  query: 'Dostyk Avenue 1',
  address: 'Dostyk Avenue 1, Almaty',
  latitude: 43.249998,
  longitude: 76.915586,
};

describe('pricing service', () => {
  it('updates quotes when tariff configuration changes', async () => {
    const originalEnv = { ...process.env };
    const baseEnv = {
      BOT_TOKEN: originalEnv.BOT_TOKEN ?? 'test-token',
      DATABASE_URL: originalEnv.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/db',
    } satisfies Record<string, string>;

    const setTariffEnv = (tariffs: PricingConfig) => {
      process.env = {
        ...process.env,
        TAXI_BASE_FARE: tariffs.taxi.baseFare.toString(),
        TAXI_PER_KM: tariffs.taxi.perKm.toString(),
        TAXI_MINIMUM_FARE: tariffs.taxi.minimumFare.toString(),
        DELIVERY_BASE_FARE: tariffs.delivery.baseFare.toString(),
        DELIVERY_PER_KM: tariffs.delivery.perKm.toString(),
        DELIVERY_MINIMUM_FARE: tariffs.delivery.minimumFare.toString(),
      };
    };

    try {
      process.env = { ...process.env, ...baseEnv };

      const tariffSetA: PricingConfig = {
        taxi: { baseFare: 1200, perKm: 85, minimumFare: 1500 },
        delivery: { baseFare: 1600, perKm: 95, minimumFare: 1900 },
      };
      setTariffEnv(tariffSetA);

      const { loadConfig } = await import('../src/config/env');
      const { createPricingService, calculateDistanceKm } = await import('../src/services/pricing');

      const configA = loadConfig();
      assert.equal(configA.pricing.taxi.baseFare, tariffSetA.taxi.baseFare);
      assert.equal(configA.pricing.delivery.baseFare, tariffSetA.delivery.baseFare);

      const serviceA = createPricingService(configA.pricing);
      const distance = calculateDistanceKm(from, to);

      const taxiQuoteA = serviceA.estimateTaxiPrice(from, to);
      assert.equal(taxiQuoteA.distanceKm, distance);
      assert.equal(taxiQuoteA.amount, computeExpectedAmount(distance, configA.pricing.taxi));

      const deliveryQuoteA = serviceA.estimateDeliveryPrice(from, to);
      assert.equal(deliveryQuoteA.distanceKm, distance);
      assert.equal(deliveryQuoteA.amount, computeExpectedAmount(distance, configA.pricing.delivery));

      const tariffSetB: PricingConfig = {
        taxi: { baseFare: 700, perKm: 25, minimumFare: 800 },
        delivery: { baseFare: 950, perKm: 30, minimumFare: 1000 },
      };
      setTariffEnv(tariffSetB);

      const configB = loadConfig();
      assert.equal(configB.pricing.taxi.baseFare, tariffSetB.taxi.baseFare);
      assert.equal(configB.pricing.delivery.baseFare, tariffSetB.delivery.baseFare);

      const serviceB = createPricingService(configB.pricing);

      const taxiQuoteB = serviceB.estimateTaxiPrice(from, to);
      assert.equal(taxiQuoteB.distanceKm, distance);
      assert.equal(taxiQuoteB.amount, computeExpectedAmount(distance, configB.pricing.taxi));
      assert.notStrictEqual(taxiQuoteB.amount, taxiQuoteA.amount);

      const deliveryQuoteB = serviceB.estimateDeliveryPrice(from, to);
      assert.equal(deliveryQuoteB.distanceKm, distance);
      assert.equal(deliveryQuoteB.amount, computeExpectedAmount(distance, configB.pricing.delivery));
      assert.notStrictEqual(deliveryQuoteB.amount, deliveryQuoteA.amount);
    } finally {
      process.env = originalEnv;
    }
  });
});
