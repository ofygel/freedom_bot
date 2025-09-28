import crypto from 'crypto';

import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { config } from '../../config';
import type { BotContext } from '../types';

const CURRENT_VERSION = '2';
const LEGACY_VERSION = '1';
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

const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

const encodeExpiry = (epochSeconds: number): string =>
  Math.max(0, Math.floor(epochSeconds)).toString(36);

const decodeExpiry = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  try {
    const decoded = Number.parseInt(value, 36);
    return Number.isNaN(decoded) ? undefined : decoded;
  } catch {
    return undefined;
  }
};

export interface WrappedCallbackData {
  version: string;
  raw: string;
  user?: string;
  nonce?: string;
  sig: string;
  expiresAt?: number;
  expiresRaw?: string;
}

export interface WrapCallbackOptions {
  secret: string;
  userId?: string | number;
  keyboardNonce?: string;
  bindToUser?: boolean;
  ttlSeconds?: number;
  issuedAt?: number;
}

export const wrapCallbackData = (raw: string, options: WrapCallbackOptions): string => {
  const parts: string[] = [CURRENT_VERSION];
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

  const ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds ?? config.bot.callbackTtlSeconds));
  const issuedAtRaw = options.issuedAt ?? Date.now();
  const issuedAtSeconds =
    issuedAtRaw > 1_000_000_000_000 ? Math.floor(issuedAtRaw / 1000) : Math.floor(issuedAtRaw);
  const expiresAtSeconds = issuedAtSeconds + ttlSeconds;
  const encodedExpiry = encodeExpiry(expiresAtSeconds);
  parts.push(`e${SEP_KV}${encodedExpiry}`);

  const signatureBase = [raw, encodedUser, encodedNonce, encodedExpiry].join('|');
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

  const version = fields[0];
  if (version !== CURRENT_VERSION && version !== LEGACY_VERSION) {
    return { ok: false };
  }

  let user = '';
  let nonce = '';
  let signature = '';
  let expiryRaw = '';

  for (let index = 1; index < fields.length; index += 1) {
    const [key, value] = fields[index].split(SEP_KV);
    if (key === 'u') {
      user = value ?? '';
    } else if (key === 'n') {
      nonce = value ?? '';
    } else if (key === 'e') {
      expiryRaw = value ?? '';
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
      version,
      raw,
      user: user || undefined,
      nonce: nonce || undefined,
      sig: signature,
      expiresRaw: expiryRaw || undefined,
      expiresAt: version === CURRENT_VERSION ? decodeExpiry(expiryRaw) : undefined,
    },
  };
};

const buildSignaturePayload = (wrapped: WrappedCallbackData): string => {
  const base = [wrapped.raw, wrapped.user ?? '', wrapped.nonce ?? ''];
  if (wrapped.version === LEGACY_VERSION) {
    return base.join('|');
  }

  return [...base, wrapped.expiresRaw ?? ''].join('|');
};

const isExpired = (wrapped: WrappedCallbackData, referenceSeconds: number): boolean =>
  typeof wrapped.expiresAt === 'number' && wrapped.expiresAt < referenceSeconds;

export const verifyCallbackData = (wrapped: WrappedCallbackData, secret: string): boolean => {
  const payload = buildSignaturePayload(wrapped);
  const expected = createHmac(payload, secret);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(wrapped.sig))) {
      return false;
    }
  } catch {
    return false;
  }

  if (wrapped.version !== LEGACY_VERSION && isExpired(wrapped, nowInSeconds())) {
    return false;
  }

  return true;
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
          ttlSeconds: config.bot.callbackTtlSeconds,
        }),
      };
    }),
  );

  if (!changed) {
    return keyboard;
  }

  return { ...keyboard, inline_keyboard };
};

