export interface AddrExtras {
  entrance?: string | null;
  floor?: string | null;
  flat?: string | null;
  intercom?: string | null;
}

export function formatAddress(addr: string, extras: AddrExtras): string {
  const parts: string[] = [];
  if (extras.entrance) parts.push(`Подъезд ${extras.entrance}`);
  if (extras.floor) parts.push(`Этаж ${extras.floor}`);
  if (extras.flat) parts.push(`Кв. ${extras.flat}`);
  if (extras.intercom) parts.push(`Домофон ${extras.intercom}`);
  return parts.length ? `${addr} (${parts.join(', ')})` : addr;
}

