import { Markup } from 'telegraf';

import { logger } from '../../../config';
import { updateUserPhone } from '../../../db/users';
import type { BotContext } from '../../types';
import {
  reportUserRegistration,
  toUserIdentity,
  type UserIdentity,
} from '../../services/reports';

export interface PhoneCollectOptions {
  /** Custom prompt shown when requesting the phone number. */
  prompt?: string;
  /** Custom label for the button that shares the phone contact. */
  buttonLabel?: string;
  /** Custom message shown when the provided contact does not belong to the user. */
  invalidContactMessage?: string;
  /** Whether an already stored phone number may be reused without prompting again. */
  allowCached?: boolean;
}

const DEFAULT_PROMPT =
  'Поделитесь, пожалуйста, номером телефона, чтобы продолжить работу с ботом.';
const DEFAULT_BUTTON_LABEL = 'Отправить мой номер телефона';
const DEFAULT_INVALID_CONTACT_MESSAGE =
  'Отправьте, пожалуйста, свой контакт через кнопку ниже.';

const buildKeyboard = (label: string) =>
  Markup.keyboard([Markup.button.contactRequest(label)])
    .oneTime()
    .resize();

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

export const phoneCollect = async (
  ctx: BotContext,
  options: PhoneCollectOptions = {},
): Promise<string | undefined> => {
  if (ctx.chat?.type !== 'private') {
    return undefined;
  }

  const allowCached = options.allowCached ?? true;
  const contact = (
    ctx.message as { contact?: { phone_number: string; user_id?: number } }
  )?.contact;

  if (contact) {
    if (
      contact.user_id !== undefined &&
      ctx.from?.id !== undefined &&
      contact.user_id !== ctx.from.id
    ) {
      const warning =
        options.invalidContactMessage ?? DEFAULT_INVALID_CONTACT_MESSAGE;
      const message = await ctx.reply(
        warning,
        buildKeyboard(options.buttonLabel ?? DEFAULT_BUTTON_LABEL),
      );
      ctx.session.awaitingPhone = true;
      ctx.session.ephemeralMessages.push(message.message_id);
      return undefined;
    }

    const phone = normalisePhone(contact.phone_number);
    ctx.session.phoneNumber = phone;
    ctx.session.awaitingPhone = false;
    if (ctx.auth?.user) {
      const authUser = ctx.auth.user;
      const hadPhone = Boolean(authUser.phone);
      if (authUser.phone !== phone) {
        try {
          await updateUserPhone({ telegramId: authUser.telegramId, phone });
        } catch (error) {
          logger.error(
            { err: error, telegramId: authUser.telegramId },
            'Failed to update user phone number',
          );
        }
      }
      authUser.phone = phone;
      if (authUser.status === 'awaiting_phone' || authUser.status === 'guest') {
        authUser.status = 'active_client';
      }

      if (!hadPhone) {
        const identity: UserIdentity = {
          telegramId: authUser.telegramId,
          username: authUser.username ?? undefined,
          firstName: authUser.firstName ?? undefined,
          lastName: authUser.lastName ?? undefined,
          phone,
        };

        await reportUserRegistration(
          ctx.telegram,
          identity,
          phone,
          authUser.role,
        );
      }
    }
    if (!ctx.auth?.user) {
      const fallback = { ...toUserIdentity(ctx.from), phone } satisfies UserIdentity;
      await reportUserRegistration(ctx.telegram, fallback, phone, 'unknown');
    }
    return phone;
  }

  if (allowCached && ctx.session.phoneNumber && !ctx.session.awaitingPhone) {
    return ctx.session.phoneNumber;
  }

  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const message = await ctx.reply(
    prompt,
    buildKeyboard(options.buttonLabel ?? DEFAULT_BUTTON_LABEL),
  );

  ctx.session.awaitingPhone = true;
  ctx.session.ephemeralMessages.push(message.message_id);

  return undefined;
};

