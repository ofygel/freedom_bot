export interface Point { lat: number; lon: number }

// Try to parse common 2GIS link forms by extracting float pairs and guessing (lat, lon)
export function parse2GisLink(url: string): Point | null {
  // collect all floats in the url
  const nums = (url.match(/-?\d+\.\d+/g) || []).map(Number);
  // Examine consecutive pairs
  for (let i = 0; i + 1 < nums.length; i++) {
    const a = nums[i], b = nums[i+1];
    // Try as (lon, lat)
    if (inLat(b) && inLon(a)) {
      const pt = { lat: b, lon: a };
      if (inAlmatyBox(pt)) return pt;
    }
    // Try as (lat, lon)
    if (inLat(a) && inLon(b)) {
      const pt = { lat: a, lon: b };
      if (inAlmatyBox(pt)) return pt;
    }
  }
  return null;
}

function inLat(v: number) { return v >= -90 && v <= 90 }
function inLon(v: number) { return v >= -180 && v <= 180 }
function inAlmatyBox(p: Point) {
  return p.lat >= 43.0 && p.lat <= 43.6 && p.lon >= 76.6 && p.lon <= 77.3;
}

// Build a 2GIS directions deeplink (approximate)
export function routeToDeeplink(from: Point, to: Point): string {
  // 2GIS directions scheme is flexible; this will open route between two coordinates
  return `https://2gis.kz/almaty/routeSearch/points/${from.lon},${from.lat};${to.lon},${to.lat}`;
}
