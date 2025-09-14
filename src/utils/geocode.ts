import type { Point } from './twoGis';

export async function geocodeAddress(query: string): Promise<Point | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'freedom-bot' } });
    const data: any[] = await res.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch {
    // ignore
  }
  return null;
}

export async function reverseGeocode(point: Point): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${point.lat}&lon=${point.lon}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'freedom-bot' } });
    const data: any = await res.json();
    return data?.display_name ?? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  } catch {
    return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
  }
}
