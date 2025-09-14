import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/users.json';

export interface User {
  id: number;
  phone: string;
  role: 'client' | 'courier';
}

function load(): Record<string, User> {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, User>;
  }
  return {};
}

function save(store: Record<string, User>) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(store, null, 2));
}

export function upsertUser(user: User) {
  const store = load();
  store[user.id] = user;
  save(store);
}

export function getUser(id: number): User | undefined {
  const store = load();
  return store[id];
}
