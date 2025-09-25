import crypto from 'crypto';

import type { AppCity } from '../../domain/cities';
import { pool } from '../../db';
import type { OrderLocation } from '../../types';

export type RecentLocationKind = 'pickup' | 'dropoff';

interface RecentLocationRow {
  location_id: string;
  query: string;
  address: string;
  lat: number;
  lon: number;
  two_gis_url: string | null;
}

const buildLocationId = (location: OrderLocation): string =>
  crypto
    .createHash('sha1')
    .update(`${location.query}|${location.address}|${location.latitude}|${location.longitude}`)
    .digest('hex');

const mapRowToLocation = (row: RecentLocationRow): OrderLocation => ({
  query: row.query,
  address: row.address,
  latitude: Number(row.lat),
  longitude: Number(row.lon),
  twoGisUrl: row.two_gis_url ?? undefined,
});

export const rememberLocation = async (
  userId: number,
  city: AppCity,
  kind: RecentLocationKind,
  location: OrderLocation,
): Promise<void> => {
  const locationId = buildLocationId(location);
  await pool.query(
    `
      INSERT INTO user_recent_locations (
        user_id,
        city,
        kind,
        location_id,
        query,
        address,
        lat,
        lon,
        two_gis_url,
        last_used_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (user_id, city, kind, location_id) DO UPDATE
      SET query = EXCLUDED.query,
          address = EXCLUDED.address,
          lat = EXCLUDED.lat,
          lon = EXCLUDED.lon,
          two_gis_url = EXCLUDED.two_gis_url,
          last_used_at = now()
    `,
    [
      userId,
      city,
      kind,
      locationId,
      location.query,
      location.address,
      location.latitude,
      location.longitude,
      location.twoGisUrl ?? null,
    ],
  );
};

export interface RecentLocationOption {
  locationId: string;
  label: string;
}

export const loadRecentLocations = async (
  userId: number,
  city: AppCity,
  kind: RecentLocationKind,
  limit = 3,
): Promise<RecentLocationOption[]> => {
  const { rows } = await pool.query<RecentLocationRow>(
    `
      SELECT location_id, query, address, lat, lon, two_gis_url
      FROM user_recent_locations
      WHERE user_id = $1 AND city = $2 AND kind = $3
      ORDER BY last_used_at DESC
      LIMIT $4
    `,
    [userId, city, kind, limit],
  );

  return rows.map((row) => ({ locationId: row.location_id, label: row.address }));
};

export const findRecentLocation = async (
  userId: number,
  city: AppCity,
  kind: RecentLocationKind,
  locationId: string,
): Promise<OrderLocation | null> => {
  const { rows } = await pool.query<RecentLocationRow>(
    `
      SELECT location_id, query, address, lat, lon, two_gis_url
      FROM user_recent_locations
      WHERE user_id = $1 AND city = $2 AND kind = $3 AND location_id = $4
      LIMIT 1
    `,
    [userId, city, kind, locationId],
  );

  const [row] = rows;
  if (!row) {
    return null;
  }

  return mapRowToLocation(row);
};
