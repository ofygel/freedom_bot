import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { Telegraf } from 'telegraf';

const FILE_PATH = 'data/chats.json';
const CHAT_SESSIONS = 'data/order_chats.json';

interface ChatMessage {
  order_id: number;
  from: number;
  to: number;
  text: string;
  created_at: string;
}

export interface OrderChat {
  order_id: number;
  customer_id: number;
  courier_id: number;
  created_at: string;
  expires_at?: string;
}

function loadMessages(): ChatMessage[] {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as ChatMessage[];
  }
  return [];
}

function saveMessages(chats: ChatMessage[]) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(chats, null, 2));
}

function loadChatSessions(): OrderChat[] {
  if (existsSync(CHAT_SESSIONS)) {
    const raw = readFileSync(CHAT_SESSIONS, 'utf-8');
    return JSON.parse(raw) as OrderChat[];
  }
  return [];
}

function saveChatSessions(sessions: OrderChat[]) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(CHAT_SESSIONS, JSON.stringify(sessions, null, 2));
}

export function createOrderChat(order_id: number, customer_id: number, courier_id: number) {
  const sessions = loadChatSessions();
  if (!sessions.find((s) => s.order_id === order_id)) {
    sessions.push({ order_id, customer_id, courier_id, created_at: new Date().toISOString() });
    saveChatSessions(sessions);
  }
}

export function markOrderChatDelivered(order_id: number) {
  const sessions = loadChatSessions();
  const chat = sessions.find((s) => s.order_id === order_id);
  if (chat) {
    chat.expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    saveChatSessions(sessions);
  }
}

export function getActiveChatByUser(userId: number): OrderChat | undefined {
  const sessions = loadChatSessions();
  const now = Date.now();
  return sessions.find(
    (s) => (!s.expires_at || new Date(s.expires_at).getTime() > now) &&
      (s.customer_id === userId || s.courier_id === userId)
  );
}

export async function sendProxyMessage(
  bot: Telegraf,
  orderId: number,
  from: number,
  to: number,
  text: string
) {
  await bot.telegram.sendMessage(to, `Заказ #${orderId}: ${text}`);
  const chats = loadMessages();
  chats.push({ order_id: orderId, from, to, text, created_at: new Date().toISOString() });
  saveMessages(chats);
}

export function cleanupOldChats() {
  const sessions = loadChatSessions();
  const now = Date.now();
  const active = sessions.filter((s) => !s.expires_at || new Date(s.expires_at).getTime() > now);
  if (active.length !== sessions.length) {
    saveChatSessions(active);
    const messages = loadMessages().filter((m) => active.some((s) => s.order_id === m.order_id));
    saveMessages(messages);
  }
  const chats = loadMessages();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const filtered = chats.filter((m) => new Date(m.created_at).getTime() > cutoff);
  if (filtered.length !== chats.length) {
    saveMessages(filtered);
  }
}
