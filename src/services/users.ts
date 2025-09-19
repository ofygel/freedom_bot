import { hasUsersCitySelectedColumn, pool } from '../db';
import type { AppCity } from '../domain/cities';

export const setUserCitySelected = async (telegramId: number, city: AppCity): Promise<void> => {
  if (!(await hasUsersCitySelectedColumn())) {
    return;
  }

  await pool.query(
    `
      INSERT INTO users (tg_id, city_selected, updated_at)
      VALUES ($1, $2, now())
      ON CONFLICT (tg_id) DO UPDATE
      SET city_selected = EXCLUDED.city_selected,
          updated_at = now()
    `,
    [telegramId, city],
  );
};

export const getUserCitySelected = async (telegramId: number): Promise<AppCity | null> => {
  if (!(await hasUsersCitySelectedColumn())) {
    return null;
  }

  const { rows } = await pool.query<{ city_selected: AppCity | null }>(
    `SELECT city_selected FROM users WHERE tg_id = $1`,
    [telegramId],
  );

  const [row] = rows;
  return row?.city_selected ?? null;
};
