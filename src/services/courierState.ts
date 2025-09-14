const online = new Set<number>();
const hidden = new Map<number, Map<number, number>>();

const cancelCounts = new Map<number, number>();
const reserveCounts = new Map<number, number>();
const cancelWarned = new Set<number>();
const reserveWarned = new Set<number>();

const CANCEL_THRESHOLD = 3;
const RESERVE_THRESHOLD = 10;

export function setCourierOnline(id: number, value: boolean) {
  if (value) online.add(id);
  else online.delete(id);
}

export function toggleCourierOnline(id: number): boolean {
  if (online.has(id)) {
    online.delete(id);
    return false;
  }
  online.add(id);
  return true;
}

export function isCourierOnline(id: number): boolean {
  return online.has(id);
}

export function getOnlineCouriers(): number[] {
  return Array.from(online.values());
}

export function hideOrderForCourier(courierId: number, orderId: number, ttlMs = 60 * 60 * 1000) {
  let map = hidden.get(courierId);
  if (!map) {
    map = new Map();
    hidden.set(courierId, map);
  }
  map.set(orderId, Date.now() + ttlMs);
}

export function isOrderHiddenForCourier(courierId: number, orderId: number): boolean {
  const map = hidden.get(courierId);
  if (!map) return false;
  const expire = map.get(orderId);
  if (!expire) return false;
  if (expire < Date.now()) {
    map.delete(orderId);
    return false;
  }
  return true;
}

function inc(map: Map<number, number>, id: number): number {
  const next = (map.get(id) ?? 0) + 1;
  map.set(id, next);
  return next;
}

export function incrementCourierCancel(id: number): { count: number; warned: boolean } {
  const count = inc(cancelCounts, id);
  const warned = count >= CANCEL_THRESHOLD && !cancelWarned.has(id);
  if (warned) cancelWarned.add(id);
  return { count, warned };
}

export function incrementCourierReserve(id: number): { count: number; warned: boolean } {
  const count = inc(reserveCounts, id);
  const warned = count >= RESERVE_THRESHOLD && !reserveWarned.has(id);
  if (warned) reserveWarned.add(id);
  return { count, warned };
}
