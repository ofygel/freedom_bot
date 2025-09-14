import fs from 'fs';
import path from 'path';
import type { Telegraf, Context } from 'telegraf';
import type { Point } from '../utils/twoGis';

let botRef: Telegraf<Context> | null = null;

export function setOrdersBot(bot: Telegraf<Context>) {
  botRef = bot;
}

const file = path.join(process.cwd(), 'data', 'orders.json');

export interface Order {
  id: number;
  customer_id: number;
  from: Point;
  to: Point;
  comment: string | null;
  price_estimate: number;
  status: 'new' | 'assigned' | 'done' | 'canceled';
  created_at: string; // ISO
}

interface CreateOrderInput {
  customer_id: number;
  from: Point;
  to: Point;
  comment: string | null;
  price_estimate: number;
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
  const order: Order = {
    id,
    customer_id: input.customer_id,
    from: input.from,
    to: input.to,
    comment: input.comment,
    price_estimate: input.price_estimate,
    status: 'new',
    created_at: new Date().toISOString(),
  };
  list.push(order);
  writeAll(list);
  return order;
}
