import { Markup, type MiddlewareFn } from 'telegraf';

import { logger } from '../../../config';
import { pool } from '../../../db';
import { setUserBlockedStatus } from '../../../db/users';
import { reportUserRegistration, toUserIdentity } from '../../services/reports';
import type { BotContext } from '../../types';

export const PHONE_HELP_BUTTON_LABEL = 'Помощь';
export const PHONE_STATUS_BUTTON_LABEL = 'Где я?';

const rememberEphemeralMessage = (ctx: BotContext, messageId?: number): void => {
  if (!messageId) {
    return;
  }

  ctx.session.ephemeralMessages.push(messageId);
};

const buildPhoneCollectKeyboard = () =>
  Markup.keyboard([
    [Markup.button.contactRequest('Поделиться контактом')],
    [Markup.button.text(PHONE_HELP_BUTTON_LABEL)],
    [Markup.button.text(PHONE_STATUS_BUTTON_LABEL)],
  ])
    .oneTime(true)
    .resize();

const buildPhoneRequestText = (): string =>
  [
    'Для работы с ботом нужен ваш номер телефона.',
    'Нужен он, чтобы подтверждать заказы и защищать аккаунт — мы не передаём номер третьим лицам и используем его только для связи по заказам.',
    '',
    'Нажмите «Поделиться контактом», чтобы Telegram отправил номер автоматически, или пришлите его вручную в формате +79991234567.',
    '',
    'Если возникли сложности, нажмите «Помощь» — подскажем, что делать.',
    'Запутались? Нажмите «Где я?» — напомню текущий шаг.',
  ].join('\n');

const buildPhoneHelpText = (): string =>
  [
    'ℹ️ Подсказка по обмену номером:',
    '• Откройте этот чат на своём телефоне.',
    '• Нажмите «Поделиться контактом», чтобы Telegram отправил номер автоматически.',
    '• Или пришлите номер вручную в формате +79991234567.',
    '',
    'Мы используем номер только для подтверждения заказов и связи с вами — его не увидят другие пользователи.',
  ].join('\n');

const normalisePhone = (phone: string): string => {
  const trimmed = phone.trim();
  if (trimmed.startsWith('+')) {
    return trimmed;
  }

  const digits = trimmed.replace(/[^0-9]/g, '');
  if (digits.length === 0) {
    return trimmed;
  }

  return `+${digits}`;
};

const isBlockedByUserError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as {
    error_code?: number;
    description?: string;
    response?: { error_code?: number; description?: string };
  };

  const errorCode = candidate.error_code ?? candidate.response?.error_code;
  if (errorCode !== 403) {
    return false;
  }

  const description = candidate.description ?? candidate.response?.description ?? '';
  return description.toLowerCase().includes('bot was blocked by the user');
};

export const askPhone = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  try {
    const message = await ctx.reply(buildPhoneRequestText(), buildPhoneCollectKeyboard());

    ctx.session.awaitingPhone = true;
    rememberEphemeralMessage(ctx, message?.message_id);
  } catch (error) {
    if (!isBlockedByUserError(error)) {
      throw error;
    }

    const telegramId = ctx.from?.id ?? ctx.chat?.id;
    logger.info({ err: error, telegramId }, 'User blocked bot when requesting phone');

    if (ctx.auth?.user) {
      ctx.auth.user.isBlocked = true;
      if (ctx.auth.user.status !== 'banned' && ctx.auth.user.status !== 'suspended') {
        ctx.auth.user.status = 'suspended';
      }
    }

    if (telegramId) {
      try {
        await setUserBlockedStatus({ telegramId, isBlocked: true });
      } catch (dbError) {
        logger.error({ err: dbError, telegramId }, 'Failed to persist user blocked status');
      }
    }
  }
};

export const savePhone: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  const fromId = ctx.from?.id;
  if (!fromId) {
    await next();
    return;
  }

  const contact = (ctx.message as { contact?: { phone_number?: string; user_id?: number } } | undefined)
    ?.contact;
  if (!contact || !contact.phone_number) {
    await next();
    return;
  }

  if (contact.user_id !== undefined && contact.user_id !== fromId) {
    logger.warn({ fromId, contactUserId: contact.user_id }, 'Ignoring contact shared by another user');
    return;
  }

  const phone = normalisePhone(contact.phone_number);
  const wasVerified = Boolean(ctx.auth?.user?.phoneVerified || ctx.session.user?.phoneVerified);

  try {
    await pool.query(
      `
        UPDATE users
        SET
          phone = $1,
          phone_verified = true,
          status = CASE
            WHEN status IN ('suspended', 'banned') THEN status
            WHEN status IN ('awaiting_phone', 'guest') THEN 'onboarding'
            WHEN status IS NULL THEN 'onboarding'
            ELSE status
          END,
          updated_at = now()
        WHERE tg_id = $2
      `,
      [phone, fromId],
    );
  } catch (error) {
    logger.error({ err: error, telegramId: fromId }, 'Failed to save verified phone number');
    await next();
    return;
  }

  ctx.session.awaitingPhone = false;
  ctx.session.phoneNumber = phone;
  const existingUser = ctx.session.user ?? { id: fromId };
  ctx.session.user = { ...existingUser, phoneVerified: true };

  if (ctx.auth?.user) {
    ctx.auth.user.phone = phone;
    ctx.auth.user.phoneVerified = true;
    if (ctx.auth.user.status === 'awaiting_phone' || ctx.auth.user.status === 'guest') {
      ctx.auth.user.status = 'onboarding';
    }
  }

  if (!wasVerified) {
    const identity = ctx.auth?.user
      ? {
          telegramId: ctx.auth.user.telegramId,
          username: ctx.auth.user.username,
          firstName: ctx.auth.user.firstName,
          lastName: ctx.auth.user.lastName,
          phone,
        }
      : { ...toUserIdentity(ctx.from), phone };

    try {
      await reportUserRegistration(ctx.telegram, identity, phone, ctx.auth?.user?.role ?? 'unknown');
    } catch (error) {
      logger.error({ err: error, telegramId: fromId }, 'Failed to report user registration');
    }
  }

  (ctx.state as { phoneJustVerified?: boolean }).phoneJustVerified = !wasVerified;

  await next();
};

export const respondToPhoneHelp: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  if (!ctx.session.awaitingPhone) {
    await next();
    return;
  }

  const message = await ctx.reply(buildPhoneHelpText(), buildPhoneCollectKeyboard());
  ctx.session.awaitingPhone = true;
  rememberEphemeralMessage(ctx, message?.message_id);
};

export const respondToPhoneStatus: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  if (!ctx.session.awaitingPhone) {
    await next();
    return;
  }

  const message = await ctx.reply(buildPhoneRequestText(), buildPhoneCollectKeyboard());
  ctx.session.awaitingPhone = true;
  rememberEphemeralMessage(ctx, message?.message_id);
};

export const ensurePhone: MiddlewareFn<BotContext> = async (ctx, next) => {
  if (ctx.chat?.type !== 'private') {
    await next();
    return;
  }

  const fromId = ctx.from?.id;
  if (!fromId) {
    await next();
    return;
  }

  if (ctx.session.user?.phoneVerified || ctx.auth?.user?.phoneVerified) {
    await next();
    return;
  }

  try {
    const { rows } = await pool.query<{ phone_verified: boolean }>(
      'SELECT phone_verified FROM users WHERE tg_id = $1',
      [fromId],
    );

    if (rows[0]?.phone_verified) {
      const existingUser = ctx.session.user ?? { id: fromId };
      ctx.session.user = { ...existingUser, phoneVerified: true };
      if (ctx.auth?.user) {
        ctx.auth.user.phoneVerified = true;
      }
      await next();
      return;
    }
  } catch (error) {
    logger.error({ err: error, telegramId: fromId }, 'Failed to check phone verification');
  }

  await askPhone(ctx);
};
