import crypto from 'crypto';

import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { config } from '../../config';
import type { BotContext } from '../types';

const VERSION = '1';
const SEP_MAIN = '#';
const SEP_FIELDS = '|';
const SEP_KV = '=';

const safeBase36 = (value: string | number): string => {
  const digitsOnly = String(value).replace(/\D+/g, '');
  if (!digitsOnly) {
    return '';
  }

  try {
    return BigInt(digitsOnly).toString(36);
  } catch {
    return '';
  }
};

const createHmac = (data: string, secret: string): string =>
  crypto.createHmac('sha256', secret).update(data).digest('base64url').slice(0, 10);

export interface WrappedCallbackData {
  raw: string;
  user?: string;
  nonce?: string;
  sig: string;
}

export interface WrapCallbackOptions {
  secret: string;
  userId?: string | number;
  keyboardNonce?: string;
  bindToUser?: boolean;
}

export const wrapCallbackData = (raw: string, options: WrapCallbackOptions): string => {
  const parts: string[] = [VERSION];
  let encodedUser = '';
  let encodedNonce = '';

  if (options.bindToUser && options.userId && options.keyboardNonce) {
    encodedUser = safeBase36(options.userId);
    encodedNonce = String(options.keyboardNonce).replace(/-/g, '').slice(0, 10);

    if (encodedUser) {
      parts.push(`u${SEP_KV}${encodedUser}`);
    }
    if (encodedNonce) {
      parts.push(`n${SEP_KV}${encodedNonce}`);
    }
  }

  const signatureBase = [raw, encodedUser, encodedNonce].join('|');
  const signature = createHmac(signatureBase, options.secret);
  parts.push(`s${SEP_KV}${signature}`);

  return `${raw}${SEP_MAIN}${parts.join(SEP_FIELDS)}`;
};

export type DecodeResult =
  | { ok: true; wrapped: WrappedCallbackData }
  | { ok: false };

export const tryDecodeCallbackData = (data: string): DecodeResult => {
  const separatorIndex = data.lastIndexOf(SEP_MAIN);
  if (separatorIndex < 0) {
    return { ok: false };
  }

  const raw = data.slice(0, separatorIndex);
  const encoded = data.slice(separatorIndex + 1);
  const fields = encoded.split(SEP_FIELDS);

  if (fields[0] !== VERSION) {
    return { ok: false };
  }

  let user = '';
  let nonce = '';
  let signature = '';

  for (let index = 1; index < fields.length; index += 1) {
    const [key, value] = fields[index].split(SEP_KV);
    if (key === 'u') {
      user = value ?? '';
    } else if (key === 'n') {
      nonce = value ?? '';
    } else if (key === 's') {
      signature = value ?? '';
    }
  }

  if (!signature) {
    return { ok: false };
  }

  return {
    ok: true,
    wrapped: {
      raw,
      user,
      nonce,
      sig: signature,
    },
  };
};

export const verifyCallbackData = (wrapped: WrappedCallbackData, secret: string): boolean => {
  const payload = [wrapped.raw, wrapped.user ?? '', wrapped.nonce ?? ''].join('|');
  const expected = createHmac(payload, secret);

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(wrapped.sig));
  } catch {
    return false;
  }
};

export const verifyCallbackForUser = (
  ctx: BotContext,
  wrapped: WrappedCallbackData,
  secret: string,
): boolean => {
  if (!verifyCallbackData(wrapped, secret)) {
    return false;
  }

  if (!wrapped.user && !wrapped.nonce) {
    return true;
  }

  const user = ctx.auth?.user;
  if (!user) {
    return false;
  }

  const encodedUser = safeBase36(user.telegramId);
  const encodedNonce = String(user.keyboardNonce ?? '').replace(/-/g, '').slice(0, 10);

  return wrapped.user === encodedUser && wrapped.nonce === encodedNonce;
};

const hasCallbackData = (
  button: InlineKeyboardMarkup['inline_keyboard'][number][number],
): button is InlineKeyboardMarkup['inline_keyboard'][number][number] & { callback_data: string } =>
  Object.prototype.hasOwnProperty.call(button, 'callback_data');

export const bindInlineKeyboardToUser = (
  ctx: BotContext,
  keyboard: InlineKeyboardMarkup | undefined,
): InlineKeyboardMarkup | undefined => {
  if (!keyboard || !keyboard.inline_keyboard || keyboard.inline_keyboard.length === 0) {
    return keyboard;
  }

  const user = ctx.auth?.user;
  if (!user?.telegramId || !user.keyboardNonce) {
    return keyboard;
  }

  const secret = config.bot.callbackSignSecret ?? config.bot.token;
  if (!secret) {
    return keyboard;
  }

  let changed = false;
  const inline_keyboard = keyboard.inline_keyboard.map((row) =>
    row.map((button) => {
      if (!hasCallbackData(button) || !button.callback_data) {
        return button;
      }

      if (tryDecodeCallbackData(button.callback_data).ok) {
        return button;
      }

      changed = true;
      return {
        ...button,
        callback_data: wrapCallbackData(button.callback_data, {
          secret,
          userId: user.telegramId,
          keyboardNonce: user.keyboardNonce,
          bindToUser: true,
        }),
      };
    }),
  );

  if (!changed) {
    return keyboard;
  }

  return { ...keyboard, inline_keyboard };
};

