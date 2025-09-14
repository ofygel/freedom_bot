import { getSettings } from '../services/settings.js';

export function calcPrice(
  distanceKm: number,
  size: 'S' | 'M' | 'L' = 'M',
  now = new Date()
): number {
  const settings = getSettings();
  const base = settings.base_price ?? 500;
  let perKm = settings.per_km ?? 180;
  const isNight = now.getHours() >= 22 || now.getHours() < 7;
  if (isNight && settings.night_active) {
    perKm *= 1.2;
  }
  const surcharge =
    (settings as any)[`surcharge_${size}` as const] ?? 0;
  let price = base + perKm * Math.max(1, distanceKm) + surcharge;
  price = Math.round(price / 10) * 10;
  return price;
}

