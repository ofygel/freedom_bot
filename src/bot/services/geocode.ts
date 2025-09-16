import { geocodeAddress, type GeocodingResult } from './geocoding';
import type { OrderLocation } from '../../types';

export const toOrderLocation = (result: GeocodingResult): OrderLocation => ({
  query: result.query,
  address: result.address,
  latitude: result.latitude,
  longitude: result.longitude,
});

export const geocodeOrderLocation = async (
  query: string,
): Promise<OrderLocation | null> => {
  const result = await geocodeAddress(query);
  return result ? toOrderLocation(result) : null;
};
