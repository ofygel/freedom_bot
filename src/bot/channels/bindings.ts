import { config, logger } from '../../config';
import { pool } from '../../db';

export type ChannelType = 'verify' | 'drivers' | 'stats';

export interface ChannelBinding {
  type: ChannelType;
  chatId: number;
}

type ChannelColumn = 'verify_channel_id' | 'drivers_channel_id' | 'stats_channel_id';

interface ChannelsRow {
  verify_channel_id: string | number | null;
  drivers_channel_id: string | number | null;
  stats_channel_id: string | number | null;
}

const CHANNEL_COLUMNS: Record<ChannelType, ChannelColumn> = {
  verify: 'verify_channel_id',
  drivers: 'drivers_channel_id',
  stats: 'stats_channel_id',
};

const parseChatId = (value: string | number): number => {
  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Failed to parse channel identifier: ${value}`);
  }

  return parsed;
};

interface CacheEntry {
  value: ChannelBinding | null;
  expiresAt: number;
}

const BINDING_CACHE = new Map<ChannelType, CacheEntry>();

const getCacheTtl = (): number => (process.env.NODE_ENV === 'test' ? 0 : 60_000);

const readFromCache = (type: ChannelType): ChannelBinding | null | undefined => {
  const ttl = getCacheTtl();
  if (ttl <= 0) {
    return undefined;
  }

  const entry = BINDING_CACHE.get(type);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    BINDING_CACHE.delete(type);
    return undefined;
  }

  return entry.value;
};

const writeToCache = (type: ChannelType, value: ChannelBinding | null): void => {
  const ttl = getCacheTtl();
  if (ttl <= 0) {
    return;
  }

  BINDING_CACHE.set(type, { value, expiresAt: Date.now() + ttl });
};

const FALLBACK_CHAT_IDS: Partial<Record<ChannelType, number>> = {
  drivers: config.subscriptions.payment.driversChannelId,
};

const persistFallbackBinding = async (
  type: ChannelType,
): Promise<ChannelBinding | null> => {
  const chatId = FALLBACK_CHAT_IDS[type];
  if (typeof chatId !== 'number') {
    return null;
  }

  const binding: ChannelBinding = { type, chatId };

  try {
    await saveChannelBinding(binding);
  } catch (error) {
    logger.error(
      { err: error, type },
      'Failed to persist fallback channel binding',
    );
  }

  writeToCache(type, binding);

  return binding;
};

export const saveChannelBinding = async (
  binding: ChannelBinding,
): Promise<void> => {
  const column = CHANNEL_COLUMNS[binding.type];

  await pool.query(
    `
      INSERT INTO channels (id, ${column})
      VALUES (1, $1)
      ON CONFLICT (id) DO UPDATE
      SET ${column} = EXCLUDED.${column}
    `,
    [binding.chatId],
  );

  writeToCache(binding.type, binding);
};

export const getChannelBinding = async (
  type: ChannelType,
): Promise<ChannelBinding | null> => {
  const cached = readFromCache(type);
  if (cached !== undefined) {
    return cached;
  }

  const column = CHANNEL_COLUMNS[type];

  const { rows } = await pool.query<ChannelsRow>(
    `
      SELECT verify_channel_id, drivers_channel_id, stats_channel_id
      FROM channels
      WHERE id = 1
      LIMIT 1
    `,
  );

  const [row] = rows;
  if (!row) {
    const fallback = await persistFallbackBinding(type);
    if (fallback) {
      return fallback;
    }

    return null;
  }

  const value = row[column];
  if (value === null || value === undefined) {
    const fallback = await persistFallbackBinding(type);
    if (fallback) {
      return fallback;
    }

    writeToCache(type, null);
    return null;
  }

  const binding = {
    type,
    chatId: parseChatId(value),
  } satisfies ChannelBinding;

  writeToCache(type, binding);

  return binding;
};

export const __testing = {
  clearBindingCache: (): void => {
    BINDING_CACHE.clear();
  },
};

