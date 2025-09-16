import type { OrderPriceDetails } from '../../types';

import {
  estimateDeliveryPrice as baseEstimateDeliveryPrice,
  estimateTaxiPrice as baseEstimateTaxiPrice,
  calculateDistanceKm,
} from '../../services/pricing';

const priceFormatter = new Intl.NumberFormat('ru-RU');

export const formatPriceAmount = (amount: number, currency: string): string =>
  `${priceFormatter.format(amount)} ${currency}`;

export const formatPriceDetails = (price: OrderPriceDetails): string =>
  formatPriceAmount(price.amount, price.currency);

export const formatDistance = (distanceKm: number): string => {
  if (!Number.isFinite(distanceKm)) {
    return 'н/д';
  }

  if (distanceKm < 0.1) {
    return '<0.1';
  }

  return distanceKm.toFixed(1);
};

export const estimateTaxiPrice = baseEstimateTaxiPrice;
export const estimateDeliveryPrice = baseEstimateDeliveryPrice;

export { calculateDistanceKm };
