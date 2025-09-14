import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/orders.json';

export interface Location {
  addr: string;
  lat?: number;
  lon?: number;
}

export interface Order {
  id: number;
  client_id: number;
  cargo_type: 'docs' | 'parcel' | 'food' | 'other';
  from: Location;
  to: Location;
  size: 'S' | 'M' | 'L';
  fragile: boolean;
  thermobox: boolean;
  cash_change_needed: boolean;
  pay_type: 'cash' | 'p2p' | 'receiver';
  comment?: string;
  created_at: string;
  status: 'open' | 'reserved' | 'assigned';
  reserved_by?: number;
  reserved_until?: string;
  message_id?: number;
}

function load(): Order[] {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Order[];
  }
  return [];
}

function save(orders: Order[]) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(orders, null, 2));
}

export function createOrder(
  order: Omit<
    Order,
    'id' | 'created_at' | 'status' | 'reserved_by' | 'reserved_until' | 'message_id'
  >
): Order {
  const orders = load();
  const last = orders[orders.length - 1];
  const id = last ? last.id + 1 : 1;
  const newOrder: Order = {
    ...order,
    id,
    created_at: new Date().toISOString(),
    status: 'open'
  };
  orders.push(newOrder);
  save(orders);
  return newOrder;
}

export function updateOrder(id: number, patch: Partial<Omit<Order, 'id'>>): Order | undefined {
  const orders = load();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  orders[idx] = { ...orders[idx], ...patch } as Order;
  save(orders);
  return orders[idx];
}

export function reserveOrder(id: number, userId: number, ttlSec = 90): Order | undefined {
  const orders = load();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const order = orders[idx]!;
  const now = Date.now();
  const expired = order.reserved_until ? new Date(order.reserved_until).getTime() < now : true;
  if (order.status === 'open' || (order.status === 'reserved' && expired)) {
    order.status = 'reserved';
    order.reserved_by = userId;
    order.reserved_until = new Date(now + ttlSec * 1000).toISOString();
    orders[idx] = order;
    save(orders);
    return order;
  }
  return undefined;
}

export function assignOrder(id: number, userId: number): Order | undefined {
  const orders = load();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const order = orders[idx]!;
  if (order.status === 'reserved' && order.reserved_by === userId) {
    order.status = 'assigned';
    orders[idx] = order;
    save(orders);
    return order;
  }
  return undefined;
}

export function releaseExpiredReservations(): Order[] {
  const orders = load();
  const now = Date.now();
  const updated: Order[] = [];
  for (const order of orders) {
    if (order.status === 'reserved' && order.reserved_until && new Date(order.reserved_until).getTime() < now) {
      order.status = 'open';
      delete order.reserved_by;
      delete order.reserved_until;
      updated.push(order);
    }
  }
  if (updated.length) {
    save(orders);
  }
  return updated;
}

export function getOrder(id: number): Order | undefined {
  const orders = load();
  return orders.find((o) => o.id === id);
}
