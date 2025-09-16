import { pool } from './client';

type VerificationRole = 'courier' | 'driver';

interface VerificationExistsRow {
  is_verified: boolean;
}

export const isExecutorVerified = async (
  telegramId: number,
  role: VerificationRole,
): Promise<boolean> => {
  const { rows } = await pool.query<VerificationExistsRow>(
    `
      SELECT COALESCE(u.is_verified, false)
        OR EXISTS (
          SELECT 1
          FROM verifications v
          WHERE v.user_id = u.id
            AND v.role = $2
            AND v.status = 'approved'
            AND (v.expires_at IS NULL OR v.expires_at > now())
        ) AS is_verified
      FROM users u
      WHERE u.telegram_id = $1
      LIMIT 1
    `,
    [telegramId, role],
  );

  const [row] = rows;
  return row?.is_verified ?? false;
};
