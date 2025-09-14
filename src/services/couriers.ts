import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';

const FILE_PATH = 'data/couriers.json';
const METRICS_PATH = 'data/courier_metrics.json';
const AUDIT_PATH = 'data/courier_audit.log';

export interface CourierMetrics {
  cancel_count: number;
  completed_count: number;
}

export interface CourierAuditRecord {
  courier_id: number;
  type: 'cancel' | 'no_movement' | 'complaint';
  details?: string;
  timestamp: string;
}

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

function loadMetrics(): Record<string, CourierMetrics> {
  if (existsSync(METRICS_PATH)) {
    const raw = readFileSync(METRICS_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, CourierMetrics>;
  }
  return {};
}

function saveMetrics(store: Record<string, CourierMetrics>) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(METRICS_PATH, JSON.stringify(store, null, 2));
}

export function recordCourierMetric(id: number, type: 'cancel' | 'complete') {
  const metrics = loadMetrics();
  const m = metrics[id] || { cancel_count: 0, completed_count: 0 };
  if (type === 'cancel') m.cancel_count++;
  else m.completed_count++;
  metrics[id] = m;
  saveMetrics(metrics);
}

export function getCourierMetrics(id: number): (CourierMetrics & { cancel_rate: number }) | undefined {
  const metrics = loadMetrics();
  const m = metrics[id];
  if (!m) return undefined;
  const total = m.cancel_count + m.completed_count;
  const cancel_rate = total > 0 ? m.cancel_count / total : 0;
  return { ...m, cancel_rate };
}

export function logCourierIssue(record: Omit<CourierAuditRecord, 'timestamp'>) {
  const line = JSON.stringify({ ...record, timestamp: new Date().toISOString() });
  if (!existsSync('data')) mkdirSync('data');
  appendFileSync(AUDIT_PATH, line + '\n');
}

export function getCourierAudit(id: number): CourierAuditRecord[] {
  if (!existsSync(AUDIT_PATH)) return [];
  const raw = readFileSync(AUDIT_PATH, 'utf-8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CourierAuditRecord)
    .filter((r) => r.courier_id === id);
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
