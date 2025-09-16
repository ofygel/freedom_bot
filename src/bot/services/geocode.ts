import type { Location as TelegramLocation } from 'telegraf/typings/core/types/typegram';

import {
  geocodeAddress,
  resolveCoordinates,
  type CoordinateResolutionOptions,
  type GeocodingResult,
} from './geocoding';
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

export const geocodeOrderCoordinates = async (
  latitude: number,
  longitude: number,
  options: CoordinateResolutionOptions = {},
): Promise<OrderLocation | null> => {
  const result = await resolveCoordinates(latitude, longitude, options);
  return result ? toOrderLocation(result) : null;
};

export const geocodeTelegramLocation = async (
  location: TelegramLocation,
  options: Omit<CoordinateResolutionOptions, 'query'> = {},
): Promise<OrderLocation | null> =>
  geocodeOrderCoordinates(location.latitude, location.longitude, options);

export { isTwoGisLink } from './geocoding';
