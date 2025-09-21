import './helpers/setup-env';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PricingConfig, TariffConfig, TariffRates } from '../src/config';
import type { OrderLocation } from '../src/types';

const roundToNearestTen = (value: number): number => Math.round(value / 10) * 10;

const computeServiceAmount = (distanceKm: number, tariff: TariffConfig): number => {
  const raw = tariff.baseFare + distanceKm * tariff.perKm;
  const rounded = roundToNearestTen(raw);
  return Math.max(tariff.minimumFare, rounded);
};

const computeGeneralAmount = (
  distanceKm: number,
  etaMinutes: number,
  tariff: TariffRates,
): number => {
  const raw = tariff.base + distanceKm * tariff.perKm + etaMinutes * tariff.perMin;
  return roundToNearestTen(raw);
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
      CITY_DEFAULT: originalEnv.CITY_DEFAULT ?? 'Алматы',
      KASPI_CARD: originalEnv.KASPI_CARD ?? '4400 0000 0000 0000',
      KASPI_NAME: originalEnv.KASPI_NAME ?? 'Freedom Bot',
      KASPI_PHONE: originalEnv.KASPI_PHONE ?? '+7 (700) 000-00-00',
      DRIVERS_CHANNEL_INVITE:
        originalEnv.DRIVERS_CHANNEL_INVITE ?? 'https://t.me/+freedom-bot-drivers',
      SUB_PRICE_7: originalEnv.SUB_PRICE_7 ?? '5000',
      SUB_PRICE_15: originalEnv.SUB_PRICE_15 ?? '9000',
      SUB_PRICE_30: originalEnv.SUB_PRICE_30 ?? '16000',
    } satisfies Record<string, string>;

    const setServiceTariffEnv = (tariffs: PricingConfig) => {
      process.env = {
        ...process.env,
        TAXI_BASE_FARE: tariffs.taxi.baseFare.toString(),
        TAXI_PER_KM: tariffs.taxi.perKm.toString(),
        TAXI_MINIMUM_FARE: tariffs.taxi.minimumFare.toString(),
        DELIVERY_BASE_FARE: tariffs.delivery.baseFare.toString(),
        DELIVERY_PER_KM: tariffs.delivery.perKm.toString(),
        DELIVERY_MINIMUM_FARE: tariffs.delivery.minimumFare.toString(),
      };
      delete process.env.TARIFF_BASE;
      delete process.env.TARIFF_PER_KM;
      delete process.env.TARIFF_PER_MIN;
    };

    try {
      process.env = { ...process.env, ...baseEnv };

      const tariffSetA: PricingConfig = {
        taxi: { baseFare: 1200, perKm: 85, minimumFare: 1500 },
        delivery: { baseFare: 1600, perKm: 95, minimumFare: 1900 },
      };
      setServiceTariffEnv(tariffSetA);

      const { loadConfig } = await import('../src/config/env');
      const {
        createPricingService,
        calculateDistanceKm,
        estimateEtaMinutes,
      } = await import('../src/bot/services/pricing');

      const configA = loadConfig();
      assert.equal(configA.pricing.taxi.baseFare, tariffSetA.taxi.baseFare);
      assert.equal(configA.pricing.delivery.baseFare, tariffSetA.delivery.baseFare);
      assert.equal(configA.tariff, null);

      const serviceA = createPricingService(configA.pricing);
      const distance = calculateDistanceKm(from, to);
      const eta = estimateEtaMinutes(distance);

      const taxiQuoteA = serviceA.estimateTaxiPrice(from, to);
      assert.equal(taxiQuoteA.distanceKm, distance);
      assert.equal(taxiQuoteA.etaMinutes, eta);
      assert.equal(taxiQuoteA.amount, computeServiceAmount(distance, configA.pricing.taxi));

      const deliveryQuoteA = serviceA.estimateDeliveryPrice(from, to);
      assert.equal(deliveryQuoteA.distanceKm, distance);
      assert.equal(deliveryQuoteA.etaMinutes, eta);
      assert.equal(
        deliveryQuoteA.amount,
        computeServiceAmount(distance, configA.pricing.delivery),
      );

      const tariffSetB: PricingConfig = {
        taxi: { baseFare: 700, perKm: 25, minimumFare: 800 },
        delivery: { baseFare: 950, perKm: 30, minimumFare: 1000 },
      };
      setServiceTariffEnv(tariffSetB);

      const configB = loadConfig();
      assert.equal(configB.pricing.taxi.baseFare, tariffSetB.taxi.baseFare);
      assert.equal(configB.pricing.delivery.baseFare, tariffSetB.delivery.baseFare);

      const serviceB = createPricingService(configB.pricing);

      const taxiQuoteB = serviceB.estimateTaxiPrice(from, to);
      assert.equal(taxiQuoteB.distanceKm, distance);
      assert.equal(taxiQuoteB.etaMinutes, eta);
      assert.equal(taxiQuoteB.amount, computeServiceAmount(distance, configB.pricing.taxi));
      assert.notStrictEqual(taxiQuoteB.amount, taxiQuoteA.amount);

      const deliveryQuoteB = serviceB.estimateDeliveryPrice(from, to);
      assert.equal(deliveryQuoteB.distanceKm, distance);
      assert.equal(deliveryQuoteB.etaMinutes, eta);
      assert.equal(
        deliveryQuoteB.amount,
        computeServiceAmount(distance, configB.pricing.delivery),
      );
      assert.notStrictEqual(deliveryQuoteB.amount, deliveryQuoteA.amount);
    } finally {
      process.env = originalEnv;
    }
  });

  it('uses the general tariff for taxi quotes when provided', async () => {
    const originalEnv = { ...process.env };
    const baseEnv = {
      BOT_TOKEN: originalEnv.BOT_TOKEN ?? 'test-token',
      DATABASE_URL: originalEnv.DATABASE_URL ?? 'postgres://user:pass@localhost:5432/db',
      CITY_DEFAULT: originalEnv.CITY_DEFAULT ?? 'Алматы',
      KASPI_CARD: originalEnv.KASPI_CARD ?? '4400 0000 0000 0000',
      KASPI_NAME: originalEnv.KASPI_NAME ?? 'Freedom Bot',
      KASPI_PHONE: originalEnv.KASPI_PHONE ?? '+7 (700) 000-00-00',
      DRIVERS_CHANNEL_INVITE:
        originalEnv.DRIVERS_CHANNEL_INVITE ?? 'https://t.me/+freedom-bot-drivers',
      SUB_PRICE_7: originalEnv.SUB_PRICE_7 ?? '5000',
      SUB_PRICE_15: originalEnv.SUB_PRICE_15 ?? '9000',
      SUB_PRICE_30: originalEnv.SUB_PRICE_30 ?? '16000',
      TAXI_BASE_FARE: '500',
      TAXI_PER_KM: '100',
      TAXI_MINIMUM_FARE: '800',
      DELIVERY_BASE_FARE: '600',
      DELIVERY_PER_KM: '110',
      DELIVERY_MINIMUM_FARE: '900',
    } satisfies Record<string, string>;

    const generalTariff: TariffRates = { base: 350, perKm: 95, perMin: 15 };

    try {
      process.env = {
        ...process.env,
        ...baseEnv,
        TARIFF_BASE: generalTariff.base.toString(),
        TARIFF_PER_KM: generalTariff.perKm.toString(),
        TARIFF_PER_MIN: generalTariff.perMin.toString(),
      };

      const { loadConfig } = await import('../src/config/env');
      const {
        createPricingService,
        calculateDistanceKm,
        estimateEtaMinutes,
      } = await import('../src/bot/services/pricing');

      const configWithTariff = loadConfig();
      assert.deepEqual(configWithTariff.tariff, generalTariff);

      const service = createPricingService(configWithTariff.pricing, configWithTariff.tariff);
      const distance = calculateDistanceKm(from, to);
      const eta = estimateEtaMinutes(distance);

      const taxiQuote = service.estimateTaxiPrice(from, to);
      assert.equal(taxiQuote.distanceKm, distance);
      assert.equal(taxiQuote.etaMinutes, eta);
      assert.equal(taxiQuote.amount, computeGeneralAmount(distance, eta, generalTariff));
      assert.notStrictEqual(
        taxiQuote.amount,
        computeServiceAmount(distance, configWithTariff.pricing.taxi),
      );

      const deliveryQuote = service.estimateDeliveryPrice(from, to);
      assert.equal(deliveryQuote.distanceKm, distance);
      assert.equal(deliveryQuote.etaMinutes, eta);
      assert.equal(
        deliveryQuote.amount,
        computeServiceAmount(distance, configWithTariff.pricing.delivery),
      );
      assert.notStrictEqual(
        deliveryQuote.amount,
        computeGeneralAmount(distance, eta, generalTariff),
      );
    } finally {
      process.env = originalEnv;
    }
  });
});
