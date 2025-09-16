import { pool } from '../db';

export type ChannelType = 'moderation' | 'drivers';

export interface ChannelBinding {
  type: ChannelType;
  chatId: number;
}

interface ChannelRow {
  type: ChannelType;
  chat_id: string | number;
}

let channelsTableEnsured = false;

const ensureChannelsTable = async (): Promise<void> => {
  if (channelsTableEnsured) {
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS channels (
      type text PRIMARY KEY,
      chat_id bigint NOT NULL
    )
  `);

  channelsTableEnsured = true;
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

export const saveChannelBinding = async (
  binding: ChannelBinding,
): Promise<void> => {
  await ensureChannelsTable();

  await pool.query(
    `
      INSERT INTO channels (type, chat_id)
      VALUES ($1, $2)
      ON CONFLICT (type) DO UPDATE
      SET chat_id = EXCLUDED.chat_id
    `,
    [binding.type, binding.chatId],
  );
};

export const getChannelBinding = async (
  type: ChannelType,
): Promise<ChannelBinding | null> => {
  await ensureChannelsTable();

  const { rows } = await pool.query<ChannelRow>(
    `SELECT type, chat_id FROM channels WHERE type = $1 LIMIT 1`,
    [type],
  );

  const [row] = rows;
  if (!row) {
    return null;
  }

  return {
    type: row.type,
    chatId: parseChatId(row.chat_id),
  };
};

