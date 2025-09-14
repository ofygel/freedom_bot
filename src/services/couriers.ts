import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'fs';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';
import type { Telegram } from 'telegraf';
import { warnUser, suspendUser } from './moderation';

const FILE_PATH = 'data/couriers.json';
const METRICS_PATH = 'data/courier_metrics.json';
const AUDIT_PATH = 'data/courier_audit.log';
const WARN_THRESHOLD = 3;
const SUSPEND_THRESHOLD = 5;

export interface CourierMetrics {
  cancel_count: number;
  completed_count: number;
  reserve_count: number;
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

export function recordCourierMetric(
  id: number,
  type: 'cancel' | 'complete' | 'reserve'
) {
  const metrics = loadMetrics();
  const m = metrics[id] || { cancel_count: 0, completed_count: 0, reserve_count: 0 };
  if (type === 'cancel') m.cancel_count++;
  else if (type === 'complete') m.completed_count++;
  else m.reserve_count++;
  metrics[id] = m;
  saveMetrics(metrics);
}

export function getCourierMetrics(
  id: number
): (CourierMetrics & { cancel_rate: number }) | undefined {
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
  if (record.type === 'cancel' || record.type === 'complaint') {
    const entries = getCourierAudit(record.courier_id).filter(
      (r) => r.type === record.type
    );
    const count = entries.length;
    if (count >= SUSPEND_THRESHOLD) {
      suspendUser(record.courier_id);
    } else if (count >= WARN_THRESHOLD) {
      warnUser(record.courier_id);
    }
  }
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

const SECRET = process.env.COURIER_SECRET || 'default_secret_key_32_bytes_long!';

function getKey() {
  return createHash('sha256').update(SECRET).digest();
}

function encrypt(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-ctr', getKey(), iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(payload: string): string {
  try {
    const [ivHex, dataHex] = payload.split(':');
    const decipher = createDecipheriv('aes-256-ctr', getKey(), Buffer.from(ivHex, 'hex'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final()
    ]);
    return dec.toString('utf8');
  } catch {
    return '';
  }
}

export function upsertCourier(profile: CourierProfile) {
  const store = load();
  store[profile.id] = { ...profile, card: encrypt(profile.card) };
  save(store);
}

export function getCourier(id: number): CourierProfile | undefined {
  const store = load();
  const prof = store[id];
  if (!prof) return undefined;
  return { ...prof, card: decrypt(prof.card) };
}

export function scheduleCardMessageDeletion(
  telegram: Telegram,
  chatId: number,
  messageId: number,
) {
  setTimeout(() => {
    telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, 2 * 60 * 60 * 1000);
}
