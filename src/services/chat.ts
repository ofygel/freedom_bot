import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { Telegraf } from 'telegraf';

const FILE_PATH = 'data/chats.json';

interface ChatMessage {
  order_id: number;
  from: number;
  to: number;
  text: string;
  created_at: string;
}

function load(): ChatMessage[] {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as ChatMessage[];
  }
  return [];
}

function save(chats: ChatMessage[]) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(chats, null, 2));
}

export async function sendProxyMessage(
  bot: Telegraf,
  orderId: number,
  from: number,
  to: number,
  text: string
) {
  await bot.telegram.sendMessage(to, `Заказ #${orderId}: ${text}`);
  const chats = load();
  chats.push({ order_id: orderId, from, to, text, created_at: new Date().toISOString() });
  save(chats);
}

export function cleanupOldChats() {
  const chats = load();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const filtered = chats.filter((m) => new Date(m.created_at).getTime() > cutoff);
  if (filtered.length !== chats.length) {
    save(filtered);
  }
}
