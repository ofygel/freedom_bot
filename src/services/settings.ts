import { promises as fs } from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'data', 'settings.json');

export interface Point { lat: number; lon: number }

export interface Settings {
  couriers_channel_id?: string;
  moderators_channel_id?: string;
  city?: 'almaty';
  verify_channel_id?: string;
  base_price?: number;
  per_km?: number;
  surcharge_S?: number;
  surcharge_M?: number;
  surcharge_L?: number;
  surcharge_thermobox?: number;
  surcharge_change?: number;
  night_active?: boolean;
  order_hours_start?: number;
  order_hours_end?: number;
  city_polygon?: Point[];
  min_price?: number;
  wait_free?: number;
  wait_per_min?: number;
}

export type BindingKey =
  | 'couriers_channel_id'
  | 'moderators_channel_id'
  | 'verify_channel_id';

const defaultPolygon: Point[] = [
  { lat: 43.0, lon: 76.6 },
  { lat: 43.6, lon: 76.6 },
  { lat: 43.6, lon: 77.3 },
  { lat: 43.0, lon: 77.3 },
];

function readNumberEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    console.warn(
      `Invalid value for environment variable ${name}: ${raw}. Falling back to default ${defaultValue}.`,
    );
    return defaultValue;
  }

  return value;
}

const defaults: Settings = {
  couriers_channel_id: process.env.COURIERS_CHANNEL_ID || undefined,
  moderators_channel_id: process.env.MODERATORS_CHANNEL_ID || undefined,
  city: (process.env.CITY as any) || 'almaty',
  verify_channel_id: process.env.VERIFY_CHANNEL_ID || undefined,
  base_price:
    process.env.BASE_PRICE !== undefined ? readNumberEnv('BASE_PRICE', 500) : 500,
  per_km: process.env.PER_KM !== undefined ? readNumberEnv('PER_KM', 180) : 180,
  surcharge_S:
    process.env.SURCHARGE_S !== undefined ? readNumberEnv('SURCHARGE_S', 0) : 0,
  surcharge_M:
    process.env.SURCHARGE_M !== undefined ? readNumberEnv('SURCHARGE_M', 0) : 0,
  surcharge_L:
    process.env.SURCHARGE_L !== undefined ? readNumberEnv('SURCHARGE_L', 0) : 0,
  surcharge_thermobox:
    process.env.SURCHARGE_THERMOBOX !== undefined
      ? readNumberEnv('SURCHARGE_THERMOBOX', 0)
      : 0,
  surcharge_change:
    process.env.SURCHARGE_CHANGE !== undefined
      ? readNumberEnv('SURCHARGE_CHANGE', 0)
      : 0,
  night_active: false,
  order_hours_start: 8,
  order_hours_end: 23,
  city_polygon: defaultPolygon,
  min_price: process.env.MIN_PRICE !== undefined ? readNumberEnv('MIN_PRICE', 0) : 0,
  wait_free: process.env.WAIT_FREE !== undefined ? readNumberEnv('WAIT_FREE', 0) : 0,
  wait_per_min:
    process.env.WAIT_PER_MIN !== undefined ? readNumberEnv('WAIT_PER_MIN', 0) : 0,
};

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return { ...defaults, ...(JSON.parse(raw) as Settings) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code && err.code !== 'ENOENT') {
      console.error('Failed to read settings file', error);
    }
    return { ...defaults };
  }
}

export async function saveSettings(s: Settings): Promise<void> {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(s, null, 2));
  } catch (error) {
    console.error('Failed to save settings', error);
  }
}

export async function saveBinding(key: BindingKey, value: string): Promise<void> {
  try {
    const s = await getSettings();
    (s as any)[key] = value;
    await saveSettings(s);
  } catch (error) {
    console.error('Failed to save binding', error);
  }
}

export async function updateSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<void> {
  try {
    const s = await getSettings();
    (s as any)[key] = value;
    await saveSettings(s);
  } catch (error) {
    console.error('Failed to update setting', error);
  }
}
