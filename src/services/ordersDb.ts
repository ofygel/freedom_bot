import { query } from '../db';

// Lightweight wrappers around SQL functions that handle
// atomic order operations in the database.

export async function tryReserveOrder(
  orderId: number,
  courierId: string,
  holdSeconds = 90,
): Promise<boolean> {
  const res = await query<{ ok: boolean }>(
    'SELECT fn_try_reserve_order($1,$2,$3) AS ok',
    [orderId, courierId, holdSeconds],
  );
  return res[0]?.ok ?? false;
}

export async function confirmStart(
  orderId: number,
  courierId: string,
): Promise<boolean> {
  const res = await query<{ ok: boolean }>(
    'SELECT fn_confirm_start($1,$2) AS ok',
    [orderId, courierId],
  );
  return res[0]?.ok ?? false;
}

export async function reopenExpiredReservations(): Promise<number> {
  const res = await query<{ count: number }>(
    'SELECT fn_reopen_expired_reservations() AS count',
  );
  return res[0]?.count ?? 0;
}

export async function advanceStatus(
  orderId: number,
  actorId: string,
  to: string,
): Promise<boolean> {
  const res = await query<{ ok: boolean }>(
    'SELECT fn_advance_status($1,$2,$3) AS ok',
    [orderId, actorId, to],
  );
  return res[0]?.ok ?? false;
}

export async function markP2PPayment(
  orderId: number,
  proof: string,
): Promise<void> {
  await query('SELECT fn_payment_p2p_mark($1,$2)', [orderId, proof]);
}

export async function confirmP2PPayment(orderId: number): Promise<void> {
  await query('SELECT fn_payment_p2p_confirm($1)', [orderId]);
}

// Convenience queries used by bot when listing orders or building links
export interface OpenOrderRow {
  id: number;
  pickup_addr: string | null;
  dropoff_addr: string | null;
  km: number;
}

export async function listOpenOrders(limit = 50): Promise<OpenOrderRow[]> {
  return query<OpenOrderRow>(
    `SELECT id,
            pickup_addr,
            dropoff_addr,
            round(ST_Distance(pickup::geography, dropoff::geography)/1000.0, 1) AS km
       FROM orders
      WHERE status='open'
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
}

export interface RouteCoords {
  id: number;
  from_lon: number;
  from_lat: number;
  to_lon: number;
  to_lat: number;
}

export async function getRouteCoords(orderId: number): Promise<RouteCoords | undefined> {
  const res = await query<RouteCoords>(
    `SELECT id,
            ST_X(pickup::geometry)  AS from_lon,
            ST_Y(pickup::geometry)  AS from_lat,
            ST_X(dropoff::geometry) AS to_lon,
            ST_Y(dropoff::geometry) AS to_lat
       FROM orders WHERE id = $1`,
    [orderId],
  );
  return res[0];
}

