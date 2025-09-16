import type { PoolClient } from './client';
import { pool } from './client';

import type {
  OrderInsertInput,
  OrderKind,
  OrderLocation,
  OrderMetadata,
  OrderPriceDetails,
  OrderRecord,
} from '../types';

interface OrderRow {
  id: number;
  kind: OrderKind;
  status: string;
  client_id: string | number | null;
  client_phone: string | null;
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
  metadata: OrderMetadata | null;
  channel_message_id: string | number | null;
  created_at: Date | string;
}

let ordersTableEnsured = false;

const ensureOrdersTable = async (): Promise<void> => {
  if (ordersTableEnsured) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      kind text NOT NULL,
      status text NOT NULL DEFAULT 'new',
      client_id bigint,
      client_phone text,
      pickup_query text NOT NULL,
      pickup_address text NOT NULL,
      pickup_lat double precision NOT NULL,
      pickup_lon double precision NOT NULL,
      dropoff_query text NOT NULL,
      dropoff_address text NOT NULL,
      dropoff_lat double precision NOT NULL,
      dropoff_lon double precision NOT NULL,
      price_amount integer NOT NULL,
      price_currency text NOT NULL,
      distance_km double precision NOT NULL,
      metadata jsonb,
      channel_message_id bigint,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  ordersTableEnsured = true;
};

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
  kind: row.kind,
  status: row.status as OrderRecord['status'],
  clientId: parseNumeric(row.client_id),
  clientPhone: row.client_phone ?? undefined,
  pickup: mapLocation(row.pickup_query, row.pickup_address, row.pickup_lat, row.pickup_lon),
  dropoff: mapLocation(row.dropoff_query, row.dropoff_address, row.dropoff_lat, row.dropoff_lon),
  price: mapPrice(row.price_amount, row.price_currency, row.distance_km),
  metadata: row.metadata ?? undefined,
  channelMessageId: parseNumeric(row.channel_message_id),
  createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
});

export const createOrder = async (input: OrderInsertInput): Promise<OrderRecord> => {
  await ensureOrdersTable();

  const { rows } = await pool.query<OrderRow>(
    `
      INSERT INTO orders (
        kind,
        status,
        client_id,
        client_phone,
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
        metadata
      )
      VALUES (
        $1,
        'new',
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
        $15
      )
      RETURNING *
    `,
    [
      input.kind,
      input.clientId ?? null,
      input.clientPhone ?? null,
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
      input.metadata ?? null,
    ],
  );

  const [row] = rows;
  if (!row) {
    throw new Error('Failed to insert order');
  }

  return mapOrderRow(row);
};

export const getOrderById = async (id: number): Promise<OrderRecord | null> => {
  await ensureOrdersTable();

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
    `UPDATE orders SET channel_message_id = $2 WHERE id = $1`,
    [id, messageId],
  );
};

export const tryClaimOrder = async (
  client: PoolClient,
  id: number,
): Promise<OrderRecord | null> => {
  const { rows } = await client.query<OrderRow>(
    `UPDATE orders SET status = 'claimed' WHERE id = $1 AND status = 'new' RETURNING *`,
    [id],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

export const tryCancelOrder = async (
  client: PoolClient,
  id: number,
): Promise<OrderRecord | null> => {
  const { rows } = await client.query<OrderRow>(
    `UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'new' RETURNING *`,
    [id],
  );

  const [row] = rows;
  return row ? mapOrderRow(row) : null;
};

export { ensureOrdersTable };
