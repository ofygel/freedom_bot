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
      SELECT EXISTS(
        SELECT 1
        FROM verifications v
        JOIN users u ON u.id = v.user_id
        WHERE u.telegram_id = $1
          AND v.type = $2
          AND v.status = 'approved'
          AND (v.expires_at IS NULL OR v.expires_at > now())
      ) AS is_verified
    `,
    [telegramId, role],
  );

  const [row] = rows;
  return row?.is_verified ?? false;
};
