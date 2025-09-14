import type { Settings } from '../services/settings.js';
import type { Point } from './twoGis.js';
import { distanceKm, isNight } from './geo.js';

type Size = 'S' | 'M' | 'L';

export function calcPrice(
  from: Point | undefined,
  to: Point | undefined,
  wait: number,
  size: Size,
  settings: Settings
): { distance: number; price: number; night: boolean } {
  let distance = 0;
  if (from && to) {
    distance = distanceKm(from, to);
  }
  const base = settings.base_price ?? 0;
  const distPart = (settings.per_km ?? 0) * distance;
  const waitExtra = Math.max(0, wait - (settings.wait_free ?? 0));
  const waitPart = waitExtra * (settings.wait_per_min ?? 0);
  const surchargeKey = size === 'S' ? 'surcharge_S' : size === 'M' ? 'surcharge_M' : 'surcharge_L';
  const surcharge = settings[surchargeKey] ?? 0;
  let total = base + distPart + waitPart + surcharge;
  let nightApplied = false;
  if (settings.night_active && settings.night_multiplier && isNight(new Date())) {
    total *= settings.night_multiplier;
    nightApplied = true;
  }
  if (settings.min_price) {
    total = Math.max(total, settings.min_price);
  }
  total = Math.round(total / 10) * 10;
  return { distance, price: total, night: nightApplied };
}
