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

export function createOrder(order: Omit<Order, 'id' | 'created_at'>): Order {
  const orders = load();
  const last = orders[orders.length - 1];
  const id = last ? last.id + 1 : 1;
  const newOrder: Order = { ...order, id, created_at: new Date().toISOString() };
  orders.push(newOrder);
  save(orders);
  return newOrder;
}
