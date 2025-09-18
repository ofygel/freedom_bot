import { pool } from './client';

export interface EnsureClientRoleParams {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export const ensureClientRole = async ({
  telegramId,
  username,
  firstName,
  lastName,
  phone,
}: EnsureClientRoleParams): Promise<void> => {
  await pool.query(
    `
      INSERT INTO users (
        tg_id,
        username,
        first_name,
        last_name,
        phone,
        role,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (tg_id) DO UPDATE
      SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        role = CASE
          WHEN users.role = 'moderator' THEN users.role
          ELSE EXCLUDED.role
        END,
        updated_at = now()
    `,
    [
      telegramId,
      username ?? null,
      firstName ?? null,
      lastName ?? null,
      phone ?? null,
      'client',
    ],
  );
};
