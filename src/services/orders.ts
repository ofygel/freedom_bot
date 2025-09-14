import fs from 'fs';
import path from 'path';
import type { Telegraf, Context } from 'telegraf';
import type { Point } from '../utils/twoGis';
import { incrementCourierReserve, incrementCourierCancel } from './courierState';
import { recordCourierMetric } from './couriers';

let botRef: Telegraf<Context> | null = null;
export function setOrdersBot(bot: Telegraf<Context>) { botRef = bot; }

const file = path.join(process.cwd(), 'data', 'orders.json');
const eventsFile = path.join(process.cwd(), 'data', 'order_events.json');

export interface OrderEvent {
  order_id: number;
  event: string;
  actor_id: number | null;
  payload: any;
  created_at: string;
}

function readEvents(): OrderEvent[] {
  try {
    return JSON.parse(fs.readFileSync(eventsFile, 'utf-8')) as OrderEvent[];
  } catch {
    return [];
  }
}

function writeEvents(list: OrderEvent[]) {
  fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
  fs.writeFileSync(eventsFile, JSON.stringify(list, null, 2));
}

function logEvent(order_id: number, event: string, actor_id: number | null, payload: any) {
  const list = readEvents();
  list.push({ order_id, event, actor_id, payload, created_at: new Date().toISOString() });
  writeEvents(list);
}

export function getOrderEvents(orderId?: number): OrderEvent[] {
  const list = readEvents();
  return orderId === undefined ? list : list.filter(e => e.order_id === orderId);
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
  payment_status?: 'pending' | 'paid';
  dispute?: Dispute;
  transitions: StatusTransition[];
  created_at: string;
}

const statusMessages: Partial<Record<OrderStatus, { client?: string; courier?: string }>> = {
  assigned: { client: 'Курьер назначен', courier: 'Заказ назначен' },
  going_to_pickup: {
    client: 'Курьер едет к отправителю',
    courier: 'Едете к отправителю',
  },
  at_pickup: { client: 'Курьер у отправителя', courier: 'У отправителя' },
  picked: { client: 'Заказ забран', courier: 'Заказ забран' },
  going_to_dropoff: {
    client: 'Курьер в пути к получателю',
    courier: 'Едете к получателю',
  },
  at_dropoff: { client: 'Курьер у получателя', courier: 'У получателя' },
  delivered: { client: 'Доставка подтверждена', courier: 'Заказ доставлен' },
  awaiting_confirm: { client: 'Ожидаем оплату', courier: 'Ожидаем оплату' },
  closed: { client: 'Заказ закрыт', courier: 'Заказ закрыт' },
  canceled: { client: 'Заказ отменён', courier: 'Заказ отменён' },
};

function notifyStatus(order: Order) {
  if (!botRef) return;
  const msg = statusMessages[order.status];
  if (!msg) return;
  if (msg.client) botRef.telegram.sendMessage(order.customer_id, msg.client).catch(() => {});
  if (order.courier_id && msg.courier)
    botRef.telegram.sendMessage(order.courier_id, msg.courier).catch(() => {});
}

function notifyPayment(order: Order) {
  if (!botRef) return;
  if (order.payment_status === 'paid') {
    botRef.telegram
      .sendMessage(order.customer_id, `Оплата заказа #${order.id} подтверждена`)
      .catch(() => {});
    if (order.courier_id)
      botRef.telegram
        .sendMessage(order.courier_id, `Оплата по заказу #${order.id} получена`)
        .catch(() => {});
  }
}

function notifyDispute(order: Order, text: string, exclude?: number) {
  if (!botRef) return;
  if (order.customer_id !== exclude)
    botRef.telegram.sendMessage(order.customer_id, text).catch(() => {});
  if (order.courier_id && order.courier_id !== exclude)
    botRef.telegram.sendMessage(order.courier_id, text).catch(() => {});
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
  logEvent(order.id, 'created', order.customer_id, input);
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
  if ('payment_status' in data) notifyPayment(order);
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
  notifyStatus(order);
  logEvent(order.id, 'reserved', courierId, { reserved_until: order.reserved_until });
  const { count, warned } = incrementCourierReserve(courierId);
  recordCourierMetric(courierId, 'reserve');
  if (warned) {
    if (botRef)
      botRef.telegram
        .sendMessage(courierId, 'Вы слишком часто резервируете заказы')
        .catch(() => {});
    logEvent(order.id, 'reserve_warn', courierId, { count });
  }
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
  notifyStatus(order);
  logEvent(order.id, 'assigned', courierId, {});
  return order;
}

export function expireReservations(): void {
  const list = readAll();
  const now = Date.now();
  let changed = false;
  for (const order of list) {
    if (
      order.status === 'reserved' &&
      order.reserved_until &&
      new Date(order.reserved_until).getTime() < now
    ) {
      const prevCourier = order.reserved_by;
      order.status = 'open';
      order.reserved_by = null;
      order.reserved_until = null;
      order.transitions.push({ status: 'open', at: new Date(now).toISOString() });
      changed = true;
      logEvent(order.id, 'reservation_expired', prevCourier ?? null, {});
      if (botRef) {
        botRef.telegram
          .sendMessage(order.customer_id, `Заказ #${order.id} возвращён в ленту`)
          .catch(() => {});
        if (prevCourier) {
          botRef.telegram
            .sendMessage(prevCourier, `Бронь заказа #${order.id} истекла`)
            .catch(() => {});
        }
      }
    }
  }
  if (changed) writeAll(list);
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
  const prevCourier = order.courier_id;
  order.status = status;
  if (courierId !== undefined) {
    order.courier_id = courierId;
  }
  if (status === 'open') {
    order.courier_id = null;
  }
  order.transitions.push({ status, at: new Date().toISOString() });
  list[index] = order;
  writeAll(list);
  notifyStatus(order);
  logEvent(order.id, 'status_updated', courierId ?? null, { status });
  if (status === 'open' && prevCourier) {
    const { count, warned } = incrementCourierCancel(prevCourier);
    recordCourierMetric(prevCourier, 'cancel');
    if (warned) {
      if (botRef)
        botRef.telegram
          .sendMessage(prevCourier, 'Вы слишком часто отменяете заказы')
          .catch(() => {});
      logEvent(order.id, 'cancel_warn', prevCourier, { count });
    }
  }
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
  logEvent(order.id, 'pickup_proof_added', null, { proof });
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
  logEvent(order.id, 'delivery_proof_added', null, { proof });
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
  notifyDispute(order, `Открыт спор по заказу #${order.id}`);
  logEvent(order.id, 'dispute_opened', null, {});
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
  const prefix =
    author === 'courier'
      ? 'Сообщение от курьера'
      : author === 'client'
      ? 'Сообщение от клиента'
      : 'Сообщение от модератора';
  const exclude =
    author === 'courier'
      ? order.courier_id ?? undefined
      : author === 'client'
      ? order.customer_id
      : undefined;
  notifyDispute(order, `${prefix}: ${text}`, exclude);
  const actorId =
    author === 'courier'
      ? order.courier_id ?? null
      : author === 'client'
      ? order.customer_id
      : null;
  logEvent(order.id, 'dispute_message', actorId, { author, text });
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
  notifyDispute(order, `Спор по заказу #${order.id} завершён`);
  logEvent(order.id, 'dispute_resolved', null, {});
  return order;
}
