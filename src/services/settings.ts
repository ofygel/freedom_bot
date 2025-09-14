import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/settings.json';

export interface Settings {
  verify_channel_id?: number;
  drivers_channel_id?: number;
  moderators_channel_id?: number;
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

export function updateSetting(key: keyof Settings, value: number) {
  const current = load();
  current[key] = value;
  save(current);
}

export function getSettings(): Settings {
  return load();
}
