import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'data', 'settings.json');

export interface Point { lat: number; lon: number }

export interface Settings {
  drivers_channel_id?: string;
  moderators_channel_id?: string;
  city?: 'almaty';
  verify_channel_id?: string;
  base_price?: number;
  per_km?: number;
  surcharge_S?: number;
  surcharge_M?: number;
  surcharge_L?: number;
  night_active?: boolean;
  order_hours_start?: number;
  order_hours_end?: number;
  city_polygon?: Point[];
  min_price?: number;
  wait_free?: number;
  wait_per_min?: number;
}

export type BindingKey =
  | 'drivers_channel_id'
  | 'moderators_channel_id'
  | 'verify_channel_id';

const defaultPolygon: Point[] = [
  { lat: 43.0, lon: 76.6 },
  { lat: 43.6, lon: 76.6 },
  { lat: 43.6, lon: 77.3 },
  { lat: 43.0, lon: 77.3 },
];

const defaults: Settings = {
  drivers_channel_id: process.env.DRIVERS_CHANNEL_ID || undefined,
  moderators_channel_id: process.env.MODERATORS_CHANNEL_ID || undefined,
  city: (process.env.CITY as any) || 'almaty',
  verify_channel_id: process.env.VERIFY_CHANNEL_ID || undefined,
  base_price: Number(process.env.BASE_PRICE) || 500,
  per_km: Number(process.env.PER_KM) || 180,
  surcharge_S: Number(process.env.SURCHARGE_S) || 0,
  surcharge_M: Number(process.env.SURCHARGE_M) || 0,
  surcharge_L: Number(process.env.SURCHARGE_L) || 0,
  night_active: false,
  order_hours_start: 8,
  order_hours_end: 23,
  city_polygon: defaultPolygon,
  min_price: Number(process.env.MIN_PRICE) || 0,
  wait_free: Number(process.env.WAIT_FREE) || 0,
  wait_per_min: Number(process.env.WAIT_PER_MIN) || 0,
};

export function getSettings(): Settings {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return { ...defaults, ...(JSON.parse(raw) as Settings) };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2));
}

export function saveBinding(key: BindingKey, value: string) {
  const s = getSettings();
  (s as any)[key] = value;
  saveSettings(s);
}

export function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  const s = getSettings();
  (s as any)[key] = value;
  saveSettings(s);
}
