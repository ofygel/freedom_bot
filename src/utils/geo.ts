import type { Point } from './twoGis';
const R = 6371;
export function distanceKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export function etaMinutes(distanceKmVal: number): number {
  const speedKmH = 28;
  return Math.max(5, Math.round((distanceKmVal / speedKmH) * 60));
}
export function isInAlmaty(p: Point): boolean {
  return p.lat >= 43.0 && p.lat <= 43.6 && p.lon >= 76.6 && p.lon <= 77.3;
}
function toRad(v: number) { return (v * Math.PI) / 180; }
