import { config } from '../config';
import type { PricingConfig, TariffConfig } from '../config';
import type { OrderLocation, OrderPriceDetails } from '../types';

const EARTH_RADIUS_KM = 6371;

const toRadians = (value: number): number => (value * Math.PI) / 180;

const calculateDistanceKm = (from: OrderLocation, to: OrderLocation): number => {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);

  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.max(0, EARTH_RADIUS_KM * c);
};

const roundPrice = (amount: number): number => Math.round(amount / 10) * 10;

const buildQuote = (from: OrderLocation, to: OrderLocation, tariff: TariffConfig): OrderPriceDetails => {
  const distanceKm = calculateDistanceKm(from, to);
  const raw = tariff.baseFare + distanceKm * tariff.perKm;
  const amount = Math.max(tariff.minimumFare, roundPrice(raw));

  return {
    amount,
    currency: 'KZT',
    distanceKm,
  } satisfies OrderPriceDetails;
};

const createEstimator = (tariff: TariffConfig) =>
  (from: OrderLocation, to: OrderLocation): OrderPriceDetails => buildQuote(from, to, tariff);

export const createPricingService = (pricing: PricingConfig) => ({
  estimateTaxiPrice: createEstimator(pricing.taxi),
  estimateDeliveryPrice: createEstimator(pricing.delivery),
});

const defaultPricingService = createPricingService(config.pricing);

export const estimateTaxiPrice = defaultPricingService.estimateTaxiPrice;

export const estimateDeliveryPrice = defaultPricingService.estimateDeliveryPrice;

export { calculateDistanceKm };
