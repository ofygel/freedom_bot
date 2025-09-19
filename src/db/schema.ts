import { pool } from './client';
import { logger } from '../config';

let hasUsersCitySelectedColumnCache: boolean | undefined;
let missingColumnLogged = false;

const CHECK_USERS_CITY_SELECTED_SQL = `
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'city_selected'
  ) AS exists
`;

export const hasUsersCitySelectedColumn = async (): Promise<boolean> => {
  if (hasUsersCitySelectedColumnCache) {
    return true;
  }

  try {
    const { rows } = await pool.query<{ exists: boolean }>(CHECK_USERS_CITY_SELECTED_SQL);
    const exists = rows[0]?.exists ?? false;

    if (exists) {
      hasUsersCitySelectedColumnCache = true;
    } else if (!missingColumnLogged) {
      logger.warn(
        { column: 'users.city_selected' },
        'users.city_selected column is missing; city selection features are disabled',
      );
      missingColumnLogged = true;
    }

    return exists;
  } catch (error) {
    if (!missingColumnLogged) {
      logger.error(
        { err: error, column: 'users.city_selected' },
        'Failed to verify users.city_selected column existence',
      );
      missingColumnLogged = true;
    }

    return false;
  }
};
