import { pool } from '../../db';

export type ChannelType = 'verify' | 'drivers';

export interface ChannelBinding {
  type: ChannelType;
  chatId: number;
}

type ChannelColumn = 'verify_channel_id' | 'drivers_channel_id';

interface ChannelsRow {
  verify_channel_id: string | number | null;
  drivers_channel_id: string | number | null;
}

const CHANNEL_COLUMNS: Record<ChannelType, ChannelColumn> = {
  verify: 'verify_channel_id',
  drivers: 'drivers_channel_id',
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
};

export const getChannelBinding = async (
  type: ChannelType,
): Promise<ChannelBinding | null> => {
  const column = CHANNEL_COLUMNS[type];

  const { rows } = await pool.query<ChannelsRow>(
    `
      SELECT verify_channel_id, drivers_channel_id
      FROM channels
      WHERE id = 1
      LIMIT 1
    `,
  );

  const [row] = rows;
  if (!row) {
    return null;
  }

  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }

  return {
    type,
    chatId: parseChatId(value),
  };
};

