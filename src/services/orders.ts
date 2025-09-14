<<<<<<< HEAD
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { Telegraf } from 'telegraf';
import { createOrderChat, markOrderChatDelivered } from './chat.js';
=======
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
>>>>>>> cdaeed7 (feat: track user moderation)

const FILE_PATH = 'data/orders.json';
const AUDIT_PATH = 'data/order_audit.log';

export interface OrderAuditRecord {
  order_id: number;
  type: 'cancel' | 'no_movement' | 'complaint';
  details?: string;
  timestamp: string;
}

export interface Location {
  addr: string;
  lat?: number;
  lon?: number;
}

export type OrderStatus =
  | 'open'
  | 'assigned'
  | 'heading_to_sender'
  | 'at_sender'
  | 'picked_up'
  | 'en_route'
  | 'at_recipient'
  | 'delivered'
  | 'closed'
  | 'dispute_open';

export interface Order {
  id: number;
  client_id: number;
  courier_id?: number;
  cargo_type: 'docs' | 'parcel' | 'food' | 'other';
  from: Location;
  to: Location;
  size: 'S' | 'M' | 'L';
  fragile: boolean;
  thermobox: boolean;
  wait_minutes: number;
  cash_change_needed: boolean;
  pay_type: 'cash' | 'p2p' | 'receiver';
  amount_total: number;
  amount_to_courier: number;
  payment_status: 'pending' | 'awaiting_confirm' | 'paid';
  comment?: string;
<<<<<<< HEAD
  status: 'new' | 'assigned' | 'delivered';
=======
  distance_km?: number;
  price?: number;
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
  created_at: string;
<<<<<<< HEAD
  status: 'open' | 'reserved' | 'assigned';
  reserved_by?: number;
  reserved_until?: string;
  message_id?: number;
=======
  status: OrderStatus;
  updated_at: string;
  pickup_proof?: string;
  delivery_proof?: string;
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)
}

let bot: Telegraf | null = null;

export function setOrdersBot(b: Telegraf) {
  bot = b;
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

<<<<<<< HEAD
<<<<<<< HEAD
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
=======
export function createOrder(order: Omit<Order, 'id' | 'created_at' | 'status' | 'updated_at'>): Order {
  const orders = load();
  const last = orders[orders.length - 1];
  const id = last ? last.id + 1 : 1;
  const now = new Date().toISOString();
  const newOrder: Order = {
    ...order,
    id,
    created_at: now,
    status: 'open',
    updated_at: now
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)
  };
=======
export function createOrder(order: Omit<Order, 'id' | 'created_at' | 'status'>): Order {
  const orders = load();
  const last = orders[orders.length - 1];
  const id = last ? last.id + 1 : 1;
  const newOrder: Order = { ...order, id, status: 'new', created_at: new Date().toISOString() };
>>>>>>> 270ffc9 (feat: add support tickets and proxy chat)
  orders.push(newOrder);
  save(orders);
  return newOrder;
}

<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
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

=======
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)
=======
>>>>>>> 270ffc9 (feat: add support tickets and proxy chat)
export function getOrder(id: number): Order | undefined {
  const orders = load();
  return orders.find((o) => o.id === id);
}
<<<<<<< HEAD
<<<<<<< HEAD
=======

export function getCourierActiveOrder(courier_id: number): Order | undefined {
  const orders = load();
  return orders.find((o) => o.courier_id === courier_id && o.status !== 'closed');
}

export function assignOrder(id: number, courier_id: number): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id && o.status === 'open');
  if (!order) return undefined;
  order.courier_id = courier_id;
  order.status = 'assigned';
  order.updated_at = new Date().toISOString();
  save(orders);
  return order;
}

export function updateOrderStatus(id: number, status: OrderStatus): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  order.status = status;
  order.updated_at = new Date().toISOString();
  save(orders);
  return order;
}

export function addPickupProof(id: number, proof: string) {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return;
  order.pickup_proof = proof;
  order.updated_at = new Date().toISOString();
  save(orders);
}

export function addDeliveryProof(id: number, proof: string) {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return;
  order.delivery_proof = proof;
  order.updated_at = new Date().toISOString();
  save(orders);
}

export function checkOrderTimeouts(
  timeoutMs: number,
  onTimeout: (order: Order) => void
) {
  const orders = load();
  const now = Date.now();
  let changed = false;
  for (const order of orders) {
    if (
      order.courier_id &&
      !['closed', 'dispute_open'].includes(order.status) &&
      now - new Date(order.updated_at).getTime() > timeoutMs
    ) {
      delete order.courier_id;
      order.status = 'open';
      order.updated_at = new Date().toISOString();
      changed = true;
      onTimeout(order);
    }
  }
  if (changed) save(orders);
}
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)
=======
export function updateOrder(id: number, data: Partial<Order>): Order | undefined {
  const orders = load();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const updated = { ...orders[idx], ...data } as Order;
  orders[idx] = updated;
  save(orders);
  return updated;
}
>>>>>>> bcad4d7 (feat: add payment fields and flows)
=======

export function getOrdersByClient(clientId: number): Order[] {
  const orders = load();
  return orders.filter((o) => o.client_id === clientId);
}

function updateOrder(id: number, data: Partial<Order>): Order | undefined {
  const orders = load();
  const index = orders.findIndex((o) => o.id === id);
  if (index === -1) return undefined;
  const existing = orders[index];
  if (!existing) return undefined;
  const updated: Order = { ...existing, ...data, id: existing.id };
  orders[index] = updated;
  save(orders);
  return updated;
}

export function updateOrderStatus(
  id: number,
  status: Order['status'],
  courierId?: number
): Order | undefined {
  const data: Partial<Order> = { status };
  if (courierId !== undefined) {
    data.courier_id = courierId;
  }
  const order = updateOrder(id, data);
  if (!order) return undefined;
  if (status === 'assigned' && order.courier_id) {
    createOrderChat(order.id, order.client_id, order.courier_id);
  }
  if (status === 'delivered') {
    markOrderChatDelivered(order.id);
  }
  if (bot) {
    const msg = STATUS_MESSAGES[status as OrderStatus];
    if (msg) {
      bot.telegram
        .sendMessage(order.client_id, msg.client.replace('{id}', String(order.id)))
        .catch(() => {});
      if (order.courier_id) {
        bot.telegram
          .sendMessage(order.courier_id, msg.courier.replace('{id}', String(order.id)))
          .catch(() => {});
      }
    }
  }
  return order;
}

const STATUS_MESSAGES: Record<OrderStatus, { client: string; courier: string }> = {
  assigned: {
    client: 'Ваш заказ #{id} назначен курьеру',
    courier: 'Вам назначен заказ #{id}',
  },
  heading_to_sender: {
    client: 'Курьер едет к отправителю по заказу #{id}',
    courier: 'Вы направляетесь к отправителю по заказу #{id}',
  },
  at_sender: {
    client: 'Курьер прибыл к отправителю по заказу #{id}',
    courier: 'Вы на месте отправителя по заказу #{id}',
  },
  picked_up: {
    client: 'Заказ #{id} забран у отправителя',
    courier: 'Вы забрали заказ #{id}',
  },
  en_route: {
    client: 'Курьер в пути с заказом #{id}',
    courier: 'Вы в пути к получателю по заказу #{id}',
  },
  at_recipient: {
    client: 'Курьер прибыл к получателю по заказу #{id}',
    courier: 'Вы прибыли к получателю по заказу #{id}',
  },
  delivered: {
    client: 'Заказ #{id} доставлен',
    courier: 'Вы доставили заказ #{id}',
  },
  open: { client: '', courier: '' },
  closed: { client: '', courier: '' },
  dispute_open: { client: '', courier: '' },
};
>>>>>>> 270ffc9 (feat: add support tickets and proxy chat)

export function logOrderIssue(record: Omit<OrderAuditRecord, 'timestamp'>) {
  const line = JSON.stringify({ ...record, timestamp: new Date().toISOString() });
  if (!existsSync('data')) mkdirSync('data');
  appendFileSync(AUDIT_PATH, line + '\n');
}

export function getOrderAudit(id: number): OrderAuditRecord[] {
  if (!existsSync(AUDIT_PATH)) return [];
  const raw = readFileSync(AUDIT_PATH, 'utf-8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as OrderAuditRecord)
    .filter((r) => r.order_id === id);
}
