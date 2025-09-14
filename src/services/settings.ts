import fs from 'fs';
import path from 'path';

const file = path.join(process.cwd(), 'data', 'settings.json');

export interface Settings {
  drivers_channel_id?: string;
  moderators_channel_id?: string;
  city?: 'almaty';
}

const defaults: Settings = {
  drivers_channel_id: process.env.DRIVERS_CHANNEL_ID || undefined,
  moderators_channel_id: process.env.MODERATORS_CHANNEL_ID || undefined,
  city: (process.env.CITY as any) || 'almaty',
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
