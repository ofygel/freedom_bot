import { pool } from './client';
import type { ExecutorKind, UserRole } from '../bot/types';

export interface EnsureClientRoleParams {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface UpdateUserRoleParams {
  telegramId: number;
  role: Exclude<UserRole, 'moderator'>;
  executorKind?: ExecutorKind | null;
  status?: 'active_client' | 'active_executor' | 'safe_mode';
  menuRole?: 'client' | 'courier';
}

export interface SetUserBlockedStatusParams {
  telegramId: number;
  isBlocked: boolean;
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
        phone_verified,
        role,
        status,
        last_menu_role,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      ON CONFLICT (tg_id) DO UPDATE
      SET
        username = COALESCE(EXCLUDED.username, users.username),
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        phone = COALESCE(EXCLUDED.phone, users.phone),
        phone_verified = CASE
          WHEN EXCLUDED.phone IS NOT NULL THEN true
          ELSE users.phone_verified
        END,
        role = CASE
          WHEN users.role = 'moderator' THEN users.role
          ELSE EXCLUDED.role
        END,
        status = CASE
          WHEN users.status IN ('suspended', 'banned', 'safe_mode') THEN users.status
          ELSE 'active_client'
        END,
        executor_kind = CASE
          WHEN users.role = 'moderator' THEN users.executor_kind
          ELSE NULL
        END,
        last_menu_role = 'client',
        updated_at = now()
    `,
    [
      telegramId,
      username ?? null,
      firstName ?? null,
      lastName ?? null,
      phone ?? null,
      phone ? true : false,
      'client',
      'active_client',
      'client',
    ],
  );
};

export interface UpdateUserPhoneParams {
  telegramId: number;
  phone: string;
}

export const updateUserPhone = async ({
  telegramId,
  phone,
}: UpdateUserPhoneParams): Promise<void> => {
  await pool.query(
    `
      UPDATE users
      SET
        phone = $2,
        phone_verified = true,
        status = CASE
          WHEN status IN ('suspended', 'banned', 'safe_mode') THEN status
          ELSE 'active_client'
        END,
        updated_at = now()
      WHERE tg_id = $1
    `,
    [telegramId, phone],
  );
};

export const updateUserRole = async ({
  telegramId,
  role,
  executorKind,
  status,
  menuRole,
}: UpdateUserRoleParams): Promise<void> => {
  const effectiveStatus = status
    ?? (role === 'client'
      ? 'active_client'
      : role === 'executor'
        ? 'active_executor'
        : 'guest');
  const effectiveMenuRole = menuRole
    ?? (role === 'client' ? 'client' : role === 'executor' ? 'courier' : 'client');
  const resolvedExecutorKind = role === 'executor' ? executorKind ?? null : null;

  await pool.query(
    `
      UPDATE users
      SET
        role = CASE
          WHEN users.role = 'moderator' THEN users.role
          ELSE $2
        END,
        executor_kind = CASE
          WHEN users.role = 'moderator' THEN users.executor_kind
          WHEN $2 = 'executor' THEN $5::executor_kind
          ELSE NULL
        END,
        status = CASE
          WHEN status IN ('suspended', 'banned', 'safe_mode') THEN status
          ELSE $3
        END,
        last_menu_role = $4,
        updated_at = now()
      WHERE tg_id = $1
    `,
    [telegramId, role, effectiveStatus, effectiveMenuRole, resolvedExecutorKind],
  );
};

export const setUserBlockedStatus = async ({
  telegramId,
  isBlocked,
}: SetUserBlockedStatusParams): Promise<void> => {
  await pool.query(
    `
      UPDATE users
      SET
        is_blocked = $2,
        updated_at = now()
      WHERE tg_id = $1
    `,
    [telegramId, isBlocked],
  );
};
