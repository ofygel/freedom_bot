export function calcPrice(distanceKm: number, now = new Date()): number {
  const isNight = now.getHours() >= 22 || now.getHours() < 7;
  const base = 500;
  const perKm = isNight ? 220 : 180;
  const price = base + perKm * Math.max(1, distanceKm);
  return Math.round(price);
}
