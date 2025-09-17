import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import type { OrderLocation } from '../../types';
import { build2GisLink } from '../../utils/location';
import { buildInlineKeyboard } from './common';

export interface OrderLocationsKeyboardOptions {
  pickupLabel?: string;
  dropoffLabel?: string;
}

export const buildOrderLocationsKeyboard = (
  pickup: OrderLocation,
  dropoff: OrderLocation,
  options: OrderLocationsKeyboardOptions = {},
): InlineKeyboardMarkup => {
  const pickupUrl = build2GisLink(pickup.latitude, pickup.longitude, { query: pickup.address });
  const dropoffUrl = build2GisLink(dropoff.latitude, dropoff.longitude, { query: dropoff.address });

  const pickupLabel = options.pickupLabel ?? '🅰️ Открыть в 2ГИС (A)';
  const dropoffLabel = options.dropoffLabel ?? '🅱️ Открыть в 2ГИС (B)';

  return buildInlineKeyboard([[{ label: pickupLabel, url: pickupUrl }, { label: dropoffLabel, url: dropoffUrl }]]);
};
