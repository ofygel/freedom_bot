import { createHash } from 'crypto';

export interface GeocodingResult {
  query: string;
  address: string;
  latitude: number;
  longitude: number;
}

const normaliseQuery = (query: string): string =>
  query
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/,+/gu, ',')
    .replace(/\s*,\s*/gu, ', ');

const toCoordinate = (hash: Buffer, start: number, range: number): number => {
  const slice = hash.subarray(start, start + 4);
  const value = slice.readUInt32BE(0);
  const normalized = value / 0xffffffff;
  return normalized * range;
};

const MIN_QUERY_LENGTH = 3;

export const geocodeAddress = async (
  query: string,
): Promise<GeocodingResult | null> => {
  if (!query || query.trim().length < MIN_QUERY_LENGTH) {
    return null;
  }

  const normalized = normaliseQuery(query);
  const digest = createHash('sha256').update(normalized.toLowerCase()).digest();

  const latitude = toCoordinate(digest, 0, 180) - 90;
  const longitude = toCoordinate(digest, 4, 360) - 180;

  return {
    query: normalized,
    address: normalized,
    latitude,
    longitude,
  } satisfies GeocodingResult;
};
