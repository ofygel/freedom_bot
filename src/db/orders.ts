import type { PoolClient } from './client';
import { pool } from './client';

import type {
  OrderInsertInput,
  OrderKind,
  OrderLocation,
  OrderPriceDetails,
  OrderRecord,
} from '../types';

interface OrderRow {
  id: number;
  short_id: string;
  kind: OrderKind;
  status: string;
  client_id: string | number | null;
  client_phone: string | null;
  customer_name: string | null;
  customer_username: string | null;
  client_comment: string | null;
  claimed_by: string | number | null;
  claimed_at: Date | string | null;
  completed_at: Date | string | null;
  pickup_query: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lon: number;
  dropoff_query: string;
  dropoff_address: string;
  dropoff_lat: number;
  dropoff_lon: number;
  price_amount: number;
  price_currency: string;
  distance_km: number | string;
  channel_message_id: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const parseNumeric = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const mapLocation = (query: string, address: string, lat: number, lon: number): OrderLocation => ({
  query,
  address,
  latitude: lat,
  longitude: lon,
});

const mapPrice = (amount: number, currency: string, distance: number | string): OrderPriceDetails => {
  const parsed =
    typeof distance === 'string' ? Number.parseFloat(distance) : distance;

  return {
    amount,
    currency,
    distanceKm: Number.isNaN(parsed) ? 0 : parsed,
  } satisfies OrderPriceDetails;
};

const mapOrderRow = (row: OrderRow): OrderRecord => ({
  id: row.id,
  shortId: row.short_id,
  kind: row.kind,
  status: row.status as OrderRecord['status'],
  clientId: parseNumeric(row.client_id),
  clientPhone: row.client_phone ?? undefined,
  customerName: row.customer_name ?? undefined,
  customerUsername: row.customer_username ?? undefined,
  clientComment: row.client_comment ?? undefined,
  claimedBy: parseNumeric(row.claimed_by),
  claimedAt:
    row.claimed_at instanceof Date
      ? row.claimed_at
      : row.claimed_at
      ? new Date(row.claimed_at)
      : undefined,
  completedAt:
    row.completed_at instanceof Date
      ? row.completed_at
      : row.completed_at
      ? new Date(row.completed_at)
      : undefined,
  pickup: mapLocation(row.pickup_query, row.pickup_address, row.pickup_lat, row.pickup_lon),
  dropoff: mapLocation(row.dropoff_query, row.dropoff_address, row.dropoff_lat, row.dropoff_lon),
  price: mapPrice(row.price_amount, row.price_currency, row.distance_km),
  channelMessageId: parseNumeric(row.channel_message_id),
  createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
});

export const createOrder = async (input: OrderInsertInput): Promise<OrderRecord> => {
  const { rows } = await pool.query<OrderRow>(
    `
      INSERT INTO orders (
        short_id,
        kind,
        status,
        client_id,
        client_phone,
        customer_name,
        customer_username,
        client_comment,
        pickup_query,
        pickup_address,
        pickup_lat,
        pickup_lon,
        dropoff_query,
        dropoff_address,
        dropoff_lat,
        dropoff_lon,
        price_amount,
        price_currency,
        distance_km,
        claimed_by,
        claimed_at,
        completed_at
      )
      VALUES (
        DEFAULT,
        $1,
        'open',
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        NULL,
        NULL,
        NULL
      )
      RETURNING *
    `,
    [
      input.kind,
      input.clientId ?? null,
      input.clientPhone ?? null,
      input.customerName ?? null,
      input.customerUsername ?? null,
      input.clientComment ?? null,
      input.pickup.query,
      input.pickup.address,
      input.pickup.latitude,
      input.pickup.longitude,
      input.dropoff.query,
      input.dropoff.address,
      input.dropoff.latitude,
      input.dropoff.longitude,
      input.price.amount,
      input.price.currency,
      input.price.distanceKm,
    ],
  );

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to insert order');
  }

  return mapOrderRow(row);
};

export const getOrderById = async (id: number): Promise<OrderRecord | null> => {
  const { rows } = await pool.query<OrderRow>(
    `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
    [id],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

export const lockOrderById = async (
  client: PoolClient,
  id: number,
): Promise<OrderRecord | null> => {
  const { rows } = await client.query<OrderRow>(
    `SELECT * FROM orders WHERE id = $1 FOR UPDATE`,
    [id],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

export const setOrderChannelMessageId = async (
  client: PoolClient,
  id: number,
  messageId: number,
): Promise<void> => {
  await client.query(
    `UPDATE orders SET channel_message_id = $2, updated_at = now() WHERE id = $1`,
    [id, messageId],
  );
};

export const tryClaimOrder = async (
  client: PoolClient,
  id: number,
  claimedBy: number,
): Promise<OrderRecord | null> => {
  const { rows } = await client.query<OrderRow>(
    `
      UPDATE orders
      SET status = 'claimed',
          claimed_by = $2,
          claimed_at = now(),
          updated_at = now()
      WHERE id = $1 AND status = 'open'
      RETURNING *
    `,
    [id, claimedBy],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

export const tryCancelOrder = async (
  client: PoolClient,
  id: number,
): Promise<OrderRecord | null> => {
  const { rows } = await client.query<OrderRow>(
    `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'open' RETURNING *`,
    [id],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

