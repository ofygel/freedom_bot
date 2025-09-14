import { getSettings } from '../services/settings';

export function calcPrice(
  distanceKm: number,
  size: 'S' | 'M' | 'L' = 'M',
  now = new Date(),
  type: 'docs' | 'parcel' | 'food' | 'other' = 'other',
  options: string[] = []
): { price: number; nightApplied: boolean } {
  const settings = getSettings();
  const base = settings.base_price ?? 500;
  let perKm = settings.per_km ?? 180;
  const isNight = now.getHours() >= 22 || now.getHours() < 7;
  let nightApplied = false;
  if (isNight && settings.night_active) {
    perKm *= 1.2;
    nightApplied = true;
  }
  const surcharge =
    (settings as any)[`surcharge_${size}` as const] ?? 0;
  const typeSurcharge: Record<typeof type, number> = {
    docs: 0,
    parcel: 200,
    food: 150,
    other: 0,
  };
  const optionSurcharges: Record<string, number> = {
    'Термобокс': (settings as any).surcharge_thermobox ?? 0,
    'Нужна сдача': (settings as any).surcharge_change ?? 0,
  };
  const optionsTotal = options.reduce(
    (sum, o) => sum + (optionSurcharges[o] || 0),
    0
  );
  let price =
    base +
    perKm * Math.max(1, distanceKm) +
    surcharge +
    typeSurcharge[type] +
    optionsTotal;
  price = Math.round(price / 10) * 10;
  return { price, nightApplied };
}

