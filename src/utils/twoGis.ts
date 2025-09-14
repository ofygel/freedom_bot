export interface Point { lat: number; lon: number }

function inLat(v: number) { return v >= -90 && v <= 90 }
function inLon(v: number) { return v >= -180 && v <= 180 }
function inAlmatyBox(p: Point) {
  return p.lat >= 43.0 && p.lat <= 43.6 && p.lon >= 76.6 && p.lon <= 77.3;
}

export function parse2GisLink(url: string): Point | null {
  const nums = (url.match(/-?\d+\.\d+/g) || []).map(Number);
  for (let i = 0; i + 1 < nums.length; i++) {
    const a = nums[i], b = nums[i+1];
    if (inLat(b) && inLon(a)) { const pt = { lat: b, lon: a }; if (inAlmatyBox(pt)) return pt; }
    if (inLat(a) && inLon(b)) { const pt = { lat: a, lon: b }; if (inAlmatyBox(pt)) return pt; }
  }
  return null;
}

export function routeToDeeplink(from: Point, to: Point): string {
  return `https://2gis.kz/almaty/routeSearch/points/${from.lon},${from.lat};${to.lon},${to.lat}`;
}
