import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/couriers.json';

export interface CourierProfile {
  id: number;
  transport: string;
  fullName: string;
  idPhoto: string;
  selfie: string;
  card: string;
  status: 'pending' | 'verified' | 'rejected' | 'repeat';
  verifyMsgId?: number;
}

function load(): Record<string, CourierProfile> {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, CourierProfile>;
  }
  return {};
}

function save(store: Record<string, CourierProfile>) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
}

export function upsertCourier(profile: CourierProfile) {
  const store = load();
  store[profile.id] = profile;
  save(store);
}

export function getCourier(id: number): CourierProfile | undefined {
  const store = load();
  return store[id];
}
