const online = new Set<number>();
const hidden = new Map<number, Map<number, number>>();

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
