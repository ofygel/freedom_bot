import { promises as fs } from 'fs';
import path from 'path';
import { distanceKm } from '../utils/geo';
import { getOrderEvents, getOrder } from './orders';

export interface DailyMetrics {
  date: string;
  orders_opened: number;
  orders_assigned: number;
  orders_delivered: number;
  orders_closed: number;
  average_distance_km: number;
}

const metricsFile = path.join(process.cwd(), 'data', 'metrics_daily.json');

async function readMetrics(): Promise<DailyMetrics[]> {
  try {
    const raw = await fs.readFile(metricsFile, 'utf-8');
    return JSON.parse(raw) as DailyMetrics[];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code !== 'ENOENT') {
      console.error('Failed to read metrics file', error);
    }
    return [];
  }
}

async function writeMetrics(list: DailyMetrics[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(metricsFile), { recursive: true });
    await fs.writeFile(metricsFile, JSON.stringify(list, null, 2));
  } catch (error) {
    console.error('Failed to write metrics file', error);
  }
}

function inRange(dateStr: string, start: Date, end: Date): boolean {
  const d = new Date(dateStr);
  return d >= start && d < end;
}

export async function rollupDailyMetrics(forDate: Date = new Date()): Promise<DailyMetrics> {
  const target = new Date(forDate.getTime() - 24 * 60 * 60 * 1000);
  const date = target.toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  const metrics: DailyMetrics = {
    date,
    orders_opened: 0,
    orders_assigned: 0,
    orders_delivered: 0,
    orders_closed: 0,
    average_distance_km: 0,
  };

  const closedDistances: number[] = [];

  const events = await getOrderEvents();
  for (const ev of events) {
    if (!inRange(ev.created_at, start, end)) continue;

    switch (ev.event) {
      case 'created':
        metrics.orders_opened++;
        break;
      case 'assigned':
        metrics.orders_assigned++;
        break;
      case 'status_updated':
        if (ev.payload?.status === 'delivered') metrics.orders_delivered++;
        if (ev.payload?.status === 'closed') {
          metrics.orders_closed++;
          const order = await getOrder(ev.order_id);
          if (order) {
            closedDistances.push(distanceKm(order.from, order.to));
          }
        }
        break;
    }
  }

  if (closedDistances.length > 0) {
    metrics.average_distance_km =
      closedDistances.reduce((a, b) => a + b, 0) / closedDistances.length;
  }

  const list = (await readMetrics()).filter(m => m.date !== metrics.date);
  list.push(metrics);
  await writeMetrics(list);

  return metrics;
}

