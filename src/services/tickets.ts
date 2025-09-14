import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

const FILE_PATH = 'data/tickets.json';

export interface Ticket {
  id: number;
  order_id: number;
  user_id: number;
  topic: string;
  text?: string;
  photo?: string;
  status: 'open' | 'in_progress' | 'resolved';
  reply?: string;
  created_at: string;
  updated_at?: string;
}

function load(): Ticket[] {
  if (existsSync(FILE_PATH)) {
    const raw = readFileSync(FILE_PATH, 'utf-8');
    return JSON.parse(raw) as Ticket[];
  }
  return [];
}

function save(tickets: Ticket[]) {
  if (!existsSync('data')) {
    mkdirSync('data');
  }
  writeFileSync(FILE_PATH, JSON.stringify(tickets, null, 2));
}

export function createTicket(
  ticket: Omit<Ticket, 'id' | 'created_at' | 'status'>
): Ticket {
  const tickets = load();
  const last = tickets[tickets.length - 1];
  const id = last ? last.id + 1 : 1;
  const newTicket: Ticket = {
    ...ticket,
    id,
    status: 'open',
    created_at: new Date().toISOString(),
  };
  tickets.push(newTicket);
  save(tickets);
  return newTicket;
}

export function updateTicketStatus(
  id: number,
  status: Ticket['status'],
  reply?: string
): Ticket | undefined {
  const tickets = load();
  const index = tickets.findIndex((t) => t.id === id);
  if (index === -1) return undefined;
  const ticket = tickets[index];
  if (!ticket) return undefined;
  ticket.status = status;
  if (reply) ticket.reply = reply;
  ticket.updated_at = new Date().toISOString();
  tickets[index] = ticket;
  save(tickets);
  return ticket;
}

export function getTicket(id: number): Ticket | undefined {
  const tickets = load();
  return tickets.find((t) => t.id === id);
}
