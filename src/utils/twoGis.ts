export interface Point { lon: number; lat: number; }
export interface Route { from: Point; to: Point; }

/**
 * Try to expand short go.2gis.com links and parse coordinates or routes
 * from regular 2GIS links.
 */
export async function parse2GisLink(link: string): Promise<Point | Route | null> {
  let finalUrl = link.trim();
  try {
    // follow short links like go.2gis.com/XXXX
    if (/go\.2gis\.com/.test(finalUrl)) {
      const res = await fetch(finalUrl, { redirect: 'follow' });
      finalUrl = res.url;
    }
    const url = new URL(finalUrl);
    if (!/2gis\./.test(url.hostname)) return null;

    // routes like https://2gis.kz/directions/points/<from>|<to>
    if (url.pathname.includes('/directions/points/')) {
      const part = url.pathname.split('/directions/points/')[1];
      if (!part) return null;
      const [fromRaw, toRaw] = part.split('|');
      if (!fromRaw || !toRaw) return null;
      const [fromLonStr, fromLatStr] = fromRaw.split(',');
      const [toLonStr, toLatStr] = toRaw.split(',');
      const fromLon = Number(fromLonStr);
      const fromLat = Number(fromLatStr);
      const toLon = Number(toLonStr);
      const toLat = Number(toLatStr);
      if ([fromLon, fromLat, toLon, toLat].some((n) => isNaN(n))) return null;
      return { from: { lon: fromLon, lat: fromLat }, to: { lon: toLon, lat: toLat } };
    }

    // point coordinates either in "m" query parameter or in /geo/ path
    const m = url.searchParams.get('m');
    let pointPart = m;
    if (!pointPart && url.pathname.includes('/geo/')) {
      pointPart = url.pathname.split('/geo/')[1] ?? null;
    }
    if (pointPart) {
      const [lonStr, latStr] = pointPart.split(',');
      const lon = Number(lonStr);
      const lat = Number(latStr);
      if ([lon, lat].some((n) => isNaN(n))) return null;
      return { lon, lat };
    }
  } catch {
    return null;
  }
  return null;
}

/** Reverse geocode using open Nominatim service */
export async function reverseGeocode(point: Point): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'freedom-bot' } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    return typeof data.display_name === 'string' ? data.display_name : null;
  } catch {
    return null;
  }
}

/** Simple address normalisation */
export function normalizeAddress(addr: string): string {
  return addr.replace(/\s+/g, ' ').trim();
}

export function pointDeeplink(p: Point): string {
  return `https://2gis.kz/?m=${p.lon},${p.lat}`;
}

export function routeDeeplink(r: Route): string {
  return `https://2gis.kz/directions/points/${r.from.lon},${r.from.lat}|${r.to.lon},${r.to.lat}`;
}

export function routeToDeeplink(p: Point): string {
  return `https://2gis.kz/directions/points/${p.lon},${p.lat}`;
}

