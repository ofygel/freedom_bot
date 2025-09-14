import fs from 'fs';
import path from 'path';
import type { Telegraf, Context } from 'telegraf';
import type { Point } from '../utils/twoGis';

let botRef: Telegraf<Context> | null = null;
export function setOrdersBot(bot: Telegraf<Context>) { botRef = bot; }

const file = path.join(process.cwd(), 'data', 'orders.json');

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
  | 'awaiting_confirm'
  | 'closed'
  | 'canceled';

export interface StatusTransition {
  status: OrderStatus;
  at: string;
}

export interface DisputeMessage {
  author: 'courier' | 'client' | 'moderator';
  text: string;
  created_at: string;
}

export interface Dispute {
  status: 'open' | 'resolved';
  messages: DisputeMessage[];
  opened_at: string;
  resolved_at?: string;
}

export interface Order {
  id: number;
  customer_id: number;
  courier_id?: number | null;
  from: Point;
  to: Point;
  type: string;
  time: string;
  options: string | null;
  size: 'S' | 'M' | 'L';
  pay_type: 'cash' | 'card' | 'receiver';
  comment: string | null;
  price: number;
  status: OrderStatus;
  reserved_by: number | null;
  reserved_until: string | null;
  pickup_proof?: string | null;
  delivery_proof?: string | null;
  dispute?: Dispute;
  transitions: StatusTransition[];
  created_at: string;
}

interface CreateOrderInput {
  customer_id: number;
  from: Point;
  to: Point;
  type: string;
  time: string;
  options: string | null;
  size: 'S' | 'M' | 'L';
  pay_type: 'cash' | 'card' | 'receiver';
  comment: string | null;
  price: number;
}

function readAll(): Order[] {
  try { return JSON.parse(fs.readFileSync(file,'utf-8')) as Order[] } catch { return [] }
}
function writeAll(list: Order[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

export function createOrder(input: CreateOrderInput): Order {
  const list = readAll();
  const id = (list.at(-1)?.id ?? 0) + 1;
  const now = new Date().toISOString();
  const order: Order = {
    id,
    customer_id: input.customer_id,
    from: input.from,
    to: input.to,
    type: input.type,
    time: input.time,
    options: input.options,
    size: input.size,
    pay_type: input.pay_type,
    comment: input.comment,
    price: input.price,
    status: 'open',
    reserved_by: null,
    reserved_until: null,
    pickup_proof: null,
    delivery_proof: null,
    dispute: undefined,
    transitions: [{ status: 'open', at: now }],
    created_at: now,
  };
  list.push(order);
  writeAll(list);
  return order;
}

export function getOrder(id: number): Order | undefined {
  return readAll().find(o => o.id === id);
}

export function getCourierActiveOrder(courierId: number): Order | undefined {
  return readAll().find(
    o => o.courier_id === courierId && !['closed', 'canceled'].includes(o.status)
  );
}

export function updateOrder(id: number, data: Partial<Order>): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = { ...list[index], ...data };
  list[index] = order;
  writeAll(list);
  return order;
}

export function reserveOrder(id: number, courierId: number): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  const now = Date.now();
  const until = order.reserved_until ? new Date(order.reserved_until).getTime() : 0;
  if (order.status === 'reserved' && until > now && order.reserved_by !== courierId) {
    return undefined;
  }
  if (order.status !== 'open' && !(order.status === 'reserved' && until <= now)) {
    return undefined;
  }
  order.status = 'reserved';
  order.reserved_by = courierId;
  order.reserved_until = new Date(now + 90 * 1000).toISOString();
  order.transitions.push({ status: 'reserved', at: new Date(now).toISOString() });
  list[index] = order;
  writeAll(list);
  return order;
}

export function assignOrder(id: number, courierId: number): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  const now = Date.now();
  const until = order.reserved_until ? new Date(order.reserved_until).getTime() : 0;
  if (order.status !== 'reserved' || order.reserved_by !== courierId || until < now) {
    return undefined;
  }
  order.status = 'assigned';
  order.courier_id = courierId;
  order.reserved_by = null;
  order.reserved_until = null;
  order.transitions.push({ status: 'assigned', at: new Date(now).toISOString() });
  list[index] = order;
  writeAll(list);
  return order;
}

export function updateOrderStatus(
  id: number,
  status: OrderStatus,
  courierId?: number | null
): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  order.status = status;
  if (courierId !== undefined) {
    order.courier_id = courierId;
  }
  order.transitions.push({ status, at: new Date().toISOString() });
  list[index] = order;
  writeAll(list);
  return order;
}

export function addPickupProof(id: number, proof: string): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  order.pickup_proof = proof;
  list[index] = order;
  writeAll(list);
  return order;
}

export function addDeliveryProof(id: number, proof: string): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  order.delivery_proof = proof;
  list[index] = order;
  writeAll(list);
  return order;
}

export function openDispute(id: number): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  if (!order.dispute) {
    order.dispute = {
      status: 'open',
      messages: [],
      opened_at: new Date().toISOString(),
    };
  }
  list[index] = order;
  writeAll(list);
  return order;
}

export function addDisputeMessage(
  id: number,
  author: 'courier' | 'client' | 'moderator',
  text: string,
): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  if (!order.dispute) return undefined;
  order.dispute.messages.push({ author, text, created_at: new Date().toISOString() });
  list[index] = order;
  writeAll(list);
  return order;
}

export function resolveDispute(id: number): Order | undefined {
  const list = readAll();
  const index = list.findIndex(o => o.id === id);
  if (index === -1) return undefined;
  const order = list[index];
  if (!order.dispute) return undefined;
  order.dispute.status = 'resolved';
  order.dispute.resolved_at = new Date().toISOString();
  list[index] = order;
  writeAll(list);
  return order;
}
