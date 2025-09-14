export interface Point { lon: number; lat: number; }
export interface Route { from: Point; to: Point; }

export async function parse2GisLink(link: string): Promise<Point | Route | null> {
  let finalUrl = link.trim();
  try {
    if (finalUrl.includes('go.2gis.com')) {
      const res = await fetch(finalUrl, { redirect: 'follow' });
      finalUrl = res.url;
    }
    const url = new URL(finalUrl);
    if (!url.hostname.endsWith('2gis.kz')) return null;
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
    const m = url.searchParams.get('m');
    if (m) {
      const [lonStr, latStr] = m.split(',');
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
