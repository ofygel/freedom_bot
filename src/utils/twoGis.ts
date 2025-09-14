export interface Point { lat: number; lon: number }

function inLat(v: number) { return v >= -90 && v <= 90 }
function inLon(v: number) { return v >= -180 && v <= 180 }

export async function parse2GisLink(url: string): Promise<Point | null> {
  let finalUrl = url.trim();
  try {
    if (/go\.2gis\.com/.test(finalUrl)) {
      const res = await fetch(finalUrl, { redirect: 'follow' });
      finalUrl = res.url || finalUrl;
    }
  } catch {
    // ignore network errors
  }

  const nums = (finalUrl.match(/-?\d+\.\d+/g) || []).map(Number);
  for (let i = 0; i + 1 < nums.length; i++) {
    const a = nums[i], b = nums[i + 1];
    if (inLat(b) && inLon(a)) return { lat: b, lon: a };
    if (inLat(a) && inLon(b)) return { lat: a, lon: b };
  }
  return null;
}

export function routeToDeeplink(from: Point, to: Point): string {
  return `https://2gis.kz/almaty/routeSearch/points/${from.lon},${from.lat};${to.lon},${to.lat}`;
}
