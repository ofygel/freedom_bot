export interface Coord { lat: number; lon: number }

const ALMATY_BOUNDS = {
  minLat: 43.0,
  maxLat: 43.4,
  minLon: 76.7,
  maxLon: 77.1
};

export function isInAlmaty({ lat, lon }: Coord): boolean {
  return lat >= ALMATY_BOUNDS.minLat && lat <= ALMATY_BOUNDS.maxLat && lon >= ALMATY_BOUNDS.minLon && lon <= ALMATY_BOUNDS.maxLon;
}

export function distanceKm(a: Coord, b: Coord): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371; // Earth radius km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

export function etaMinutes(distance: number): number {
  const speedKmh = 30; // average courier speed
  return Math.round((distance / speedKmh) * 60);
}

export function isNight(date: Date): boolean {
  const h = date.getHours();
  return h < 7 || h >= 22;
}

export function calcPrice(distance: number, size: 'S' | 'M' | 'L', opts: { fragile: boolean; thermobox: boolean; night: boolean }): number {
  let price = 500 + distance * 100; // base + per km
  const coef = size === 'M' ? 1.2 : size === 'L' ? 1.5 : 1;
  price *= coef;
  if (opts.fragile) price += 200;
  if (opts.thermobox) price += 300;
  if (opts.night) price *= 1.5;
  return Math.round(price);
}
