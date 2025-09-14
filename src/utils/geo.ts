import type { Point } from './twoGis';
const R = 6371;

const ALMATY_POLYGON: Point[] = [
  { lat: 43.0, lon: 76.6 },
  { lat: 43.6, lon: 76.6 },
  { lat: 43.6, lon: 77.3 },
  { lat: 43.0, lon: 77.3 },
];
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
  return pointInPolygon(p, ALMATY_POLYGON);
}

export function pointInPolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon, yi = poly[i].lat;
    const xj = poly[j].lon, yj = poly[j].lat;
    const intersect = ((yi > p.lat) !== (yj > p.lat)) &&
      (p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function toRad(v: number) { return (v * Math.PI) / 180; }
