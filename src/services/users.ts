import fs from 'fs';
import path from 'path';

export interface User {
  id: number;
  role?: 'client' | 'courier' | 'admin';
  phone?: string;
  city?: string;
  consent?: boolean;
}

const file = path.join(process.cwd(), 'data', 'users.json');

function readAll(): User[] {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as User[];
  } catch {
    return [];
  }
}

function writeAll(list: User[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2));
}

export function getUser(id: number): User | undefined {
  return readAll().find((u) => u.id === id);
}

export function upsertUser(user: User): User {
  const list = readAll();
  const idx = list.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...user };
  } else {
    list.push(user);
  }
  writeAll(list);
  return list[idx >= 0 ? idx : list.length - 1];
}

export function getAllUsers(): User[] {
  return readAll();
}

