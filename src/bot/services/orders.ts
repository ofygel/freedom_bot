import type { BotContext, ClientOrderDraftState } from '../types';
import type { OrderLocation, OrderPriceDetails } from '../../types';
import { formatDistance, formatEtaMinutes, formatPriceAmount } from './pricing';

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
  etaLabel?: string;
  priceLabel?: string;
  includeDistance?: boolean;
  includeEta?: boolean;
  includePrice?: boolean;
  instructions?: string[];
}

export const buildOrderSummary = (
  draft: CompletedOrderDraft,
  options: OrderSummaryOptions,
): string => {
  const lines = [options.title.trim(), ''];

  const pickupLabel = options.pickupLabel ?? '📍 Пункт отправления';
  const dropoffLabel = options.dropoffLabel ?? '🎯 Пункт назначения';
  lines.push(`${pickupLabel}: ${draft.pickup.address}`);
  lines.push(`${dropoffLabel}: ${draft.dropoff.address}`);

  if (options.includeDistance ?? true) {
    const distanceLabel = options.distanceLabel ?? '📏 Расстояние';
    lines.push(`${distanceLabel}: ${formatDistance(draft.price.distanceKm)} км`);
  }

  if (options.includeEta ?? true) {
    const etaLabel = options.etaLabel ?? '⏱️ В пути';
    lines.push(`${etaLabel}: ≈${formatEtaMinutes(draft.price.etaMinutes)} мин`);
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
  const first = ctx.auth.user.firstName?.trim();
  const last = ctx.auth.user.lastName?.trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  return full || undefined;
};
