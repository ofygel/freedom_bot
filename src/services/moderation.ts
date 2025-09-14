import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';

const FILE_PATH = 'data/moderation.json';
const DISPUTE_LOG = 'data/disputes.log';

export interface ModerationInfo {
  warnings: number;
  status: 'active' | 'suspended' | 'banned';
}

function load(): Record<string, ModerationInfo> {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, ModerationInfo>;
  }
  return {};
}

function save(store: Record<string, ModerationInfo>) {
  if (!existsSync('data')) mkdirSync('data');
  writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
}

export function warnUser(id: number) {
  const store = load();
  const info = store[id] || { warnings: 0, status: 'active' };
  info.warnings += 1;
  store[id] = info;
  save(store);
}

export function suspendUser(id: number) {
  const store = load();
  const info = store[id] || { warnings: 0, status: 'active' };
  info.status = 'suspended';
  store[id] = info;
  save(store);
}

export function banUser(id: number) {
  const store = load();
  const info = store[id] || { warnings: 0, status: 'active' };
  info.status = 'banned';
  store[id] = info;
  save(store);
}

export function unbanUser(id: number) {
  const store = load();
  const info = store[id] || { warnings: 0, status: 'active' };
  info.status = 'active';
  store[id] = info;
  save(store);
}

export function getModerationInfo(id: number): ModerationInfo | undefined {
  const store = load();
  return store[id];
}

export function logDisputeResolution(orderId: number, resolution: string) {
  if (!existsSync('data')) mkdirSync('data');
  const line = JSON.stringify({ order_id: orderId, resolution, timestamp: new Date().toISOString() });
  appendFileSync(DISPUTE_LOG, line + '\n');
}
