import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/settings.json';

export interface Settings {
  verify_channel_id?: number;
  drivers_channel_id?: number;
  moderators_channel_id?: number;
  base_price?: number;
  per_km?: number;
  min_price?: number;
  wait_free?: number;
  wait_per_min?: number;
  surcharge_S?: number;
  surcharge_M?: number;
  surcharge_L?: number;
  night_multiplier?: number;
  night_active?: boolean;
  city_polygon?: { lat: number; lon: number }[];
  order_hours_start?: number;
  order_hours_end?: number;
}

function load(): Settings {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Settings;
  }
  return {};
}

function save(settings: Settings) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(settings, null, 2));
}

export function updateSetting(key: keyof Settings, value: any) {
  const current = load();
  (current as any)[key] = value;
  save(current);
}

export function getSettings(): Settings {
  return load();
}
