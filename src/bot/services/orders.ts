import type { BotContext, ClientOrderDraftState } from '../types';
import type { OrderLocation, OrderPriceDetails } from '../../types';
import { build2GisLink } from '../../utils/location';

import { formatDistance, formatPriceAmount } from './pricing';

export type CompletedOrderDraft = ClientOrderDraftState & {
  pickup: OrderLocation;
  dropoff: OrderLocation;
  price: OrderPriceDetails;
};

export const resetClientOrderDraft = (draft: ClientOrderDraftState): void => {
  draft.stage = 'idle';
  draft.pickup = undefined;
  draft.dropoff = undefined;
  draft.price = undefined;
  draft.confirmationMessageId = undefined;
  draft.notes = undefined;
};

export const isOrderDraftComplete = (
  draft: ClientOrderDraftState,
): draft is CompletedOrderDraft =>
  Boolean(draft.pickup && draft.dropoff && draft.price);

export interface OrderSummaryOptions {
  title: string;
  pickupLabel?: string;
  dropoffLabel?: string;
  distanceLabel?: string;
  priceLabel?: string;
  includeDistance?: boolean;
  includePrice?: boolean;
  instructions?: string[];
}

const buildOrderLocationLink = (location: OrderLocation): string =>
  build2GisLink(location.latitude, location.longitude, { query: location.address });

export const buildOrderSummary = (
  draft: CompletedOrderDraft,
  options: OrderSummaryOptions,
): string => {
  const lines = [options.title.trim(), ''];

  const pickupLabel = options.pickupLabel ?? '📍 Пункт отправления';
  const dropoffLabel = options.dropoffLabel ?? '🎯 Пункт назначения';
  lines.push(`${pickupLabel}: ${draft.pickup.address}`);
  lines.push(`${pickupLabel} (2ГИС): ${buildOrderLocationLink(draft.pickup)}`);
  lines.push(`${dropoffLabel}: ${draft.dropoff.address}`);
  lines.push(`${dropoffLabel} (2ГИС): ${buildOrderLocationLink(draft.dropoff)}`);

  if (options.includeDistance ?? true) {
    const distanceLabel = options.distanceLabel ?? '📏 Расстояние';
    lines.push(`${distanceLabel}: ${formatDistance(draft.price.distanceKm)} км`);
  }

  if (options.includePrice ?? true) {
    const priceLabel = options.priceLabel ?? '💰 Стоимость';
    lines.push(`${priceLabel}: ${formatPriceAmount(draft.price.amount, draft.price.currency)}`);
  }

  const instructions = options.instructions ?? [
    'Подтвердите заказ или отмените оформление.',
  ];

  if (instructions.length > 0) {
    lines.push('');
    lines.push(...instructions);
  }

  return lines.join('\n');
};

export const buildCustomerName = (ctx: BotContext): string | undefined => {
  const first = ctx.session.user?.firstName?.trim();
  const last = ctx.session.user?.lastName?.trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || undefined;
};
