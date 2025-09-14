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
  | 'reserved'
  | 'assigned'
  | 'going_to_pickup'
  | 'at_pickup'
  | 'picked'
  | 'going_to_dropoff'
  | 'at_dropoff'
  | 'delivered'
  | 'closed'
  | 'dispute_open';

interface StatusLog {
  status: OrderStatus;
  at: string;
}

interface DisputeMessage {
  from: 'courier' | 'moderator';
  text: string;
  at: string;
}

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
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  reserved_by?: number;
  reserved_until?: string;
  message_id?: number;
  pickup_code: string;
  dropoff_code: string;
  pickup_proof?: string;
  delivery_proof?: string;
  status_log: StatusLog[];
  payout_hold?: boolean;
  dispute_messages?: DisputeMessage[];
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

function generateCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function createOrder(
  order: Omit<
    Order,
    | 'id'
    | 'status'
    | 'created_at'
    | 'updated_at'
    | 'status_log'
    | 'pickup_code'
    | 'dropoff_code'
    | 'payout_hold'
    | 'dispute_messages'
  >
): Order {
  const orders = load();
  const last = orders[orders.length - 1];
  const id = last ? last.id + 1 : 1;
  const now = new Date().toISOString();
  const newOrder: Order = {
    ...order,
    id,
    status: 'open',
    created_at: now,
    updated_at: now,
    pickup_code: generateCode(),
    dropoff_code: generateCode(),
    status_log: [{ status: 'open', at: now }],
  };
  orders.push(newOrder);
  save(orders);
  return newOrder;
}

function updateOrder(id: number, patch: Partial<Order>): Order | undefined {
  const orders = load();
  const idx = orders.findIndex((o) => o.id === id);
  if (idx === -1) return undefined;
  const order = { ...orders[idx], ...patch } as Order;
  orders[idx] = order;
  save(orders);
  return order;
}

export function getOrder(id: number): Order | undefined {
  const orders = load();
  return orders.find((o) => o.id === id);
}

export function getOrdersByClient(clientId: number): Order[] {
  const orders = load();
  return orders.filter((o) => o.client_id === clientId);
}

export function reserveOrder(
  id: number,
  userId: number,
  ttlSec = 90
): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  const now = Date.now();
  const expired = order.reserved_until
    ? new Date(order.reserved_until).getTime() < now
    : true;
  if (order.status === 'open' || (order.status === 'reserved' && expired)) {
    order.status = 'reserved';
    order.reserved_by = userId;
    order.reserved_until = new Date(now + ttlSec * 1000).toISOString();
    order.updated_at = new Date().toISOString();
    order.status_log.push({ status: 'reserved', at: order.updated_at });
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
    if (
      order.status === 'reserved' &&
      order.reserved_until &&
      new Date(order.reserved_until).getTime() < now
    ) {
      order.status = 'open';
      delete order.reserved_by;
      delete order.reserved_until;
      order.updated_at = new Date().toISOString();
      order.status_log.push({ status: 'open', at: order.updated_at });
      updated.push(order);
    }
  }
  if (updated.length) save(orders);
  return updated;
}

export function assignOrder(id: number, courier_id: number): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  if (
    order.status === 'open' ||
    (order.status === 'reserved' && order.reserved_by === courier_id)
  ) {
    order.courier_id = courier_id;
    order.status = 'assigned';
    order.updated_at = new Date().toISOString();
    order.status_log.push({ status: 'assigned', at: order.updated_at });
    save(orders);
    return order;
  }
  return undefined;
}

export function getCourierActiveOrder(courier_id: number): Order | undefined {
  const orders = load();
  return orders.find(
    (o) => o.courier_id === courier_id && o.status !== 'closed'
  );
}

export function updateOrderStatus(
  id: number,
  status: OrderStatus
): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  order.status = status;
  const now = new Date().toISOString();
  order.updated_at = now;
  order.status_log.push({ status, at: now });
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
      order.status_log.push({ status: 'open', at: order.updated_at });
      changed = true;
      onTimeout(order);
    }
  }
  if (changed) save(orders);
}

export function openDispute(id: number): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  order.status = 'dispute_open';
  order.payout_hold = true;
  order.dispute_messages = [];
  const now = new Date().toISOString();
  order.updated_at = now;
  order.status_log.push({ status: 'dispute_open', at: now });
  save(orders);
  return order;
}

export function addDisputeMessage(
  id: number,
  from: 'courier' | 'moderator',
  text: string
): Order | undefined {
<<<<<<< HEAD
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
=======
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order || order.status !== 'dispute_open') return undefined;
  if (!order.dispute_messages) order.dispute_messages = [];
  order.dispute_messages.push({ from, text, at: new Date().toISOString() });
  order.updated_at = new Date().toISOString();
  save(orders);
  return order;
}

export function resolveDispute(id: number): Order | undefined {
  const orders = load();
  const order = orders.find((o) => o.id === id);
  if (!order) return undefined;
  order.payout_hold = false;
  const now = new Date().toISOString();
  order.updated_at = now;
  order.status = 'closed';
  order.status_log.push({ status: 'closed', at: now });
  save(orders);
  return order;
}
>>>>>>> 55a7169 (feat: extend courier workflow and disputes)
