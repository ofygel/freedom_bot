import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import type { BotContext } from '../../types';
import { copy } from '../../copy';
import { buildInlineKeyboard } from '../../keyboards/common';
import { bindInlineKeyboardToUser } from '../../services/callbackTokens';

export const PROFILE_BUTTON_LABEL = '👤 Профиль';

export interface ProfileCardNavigationOptions {
  backAction: string;
  homeAction: string;
}

export interface ProfileCardActionOptions extends ProfileCardNavigationOptions {
  onAnswerError?: (error: unknown) => void;
}

export const buildProfileCardText = (ctx: BotContext): string => {
  const authUser = ctx.auth?.user;
  const lines = ['👤 Профиль', ''];

  if (!authUser) {
    lines.push('Данные профиля временно недоступны.');
    return lines.join('\n');
  }

  const phoneLabel = authUser.phone
    ? `${authUser.phone}${authUser.phoneVerified ? ' (подтверждён)' : ' (не подтверждён)'}`
    : '—';

  lines.push(`ID: ${authUser.telegramId}`);
  lines.push(`Имя: ${authUser.firstName ?? '—'} ${authUser.lastName ?? ''}`.trim());
  lines.push(`Логин: ${authUser.username ? `@${authUser.username}` : '—'}`);
  lines.push(`Роль: ${authUser.role}`);
  lines.push(`Статус: ${authUser.status}`);
  lines.push(`Телефон: ${phoneLabel}`);
  lines.push(`Город: ${authUser.citySelected ?? '—'}`);

  return lines.join('\n');
};

const buildProfileCardKeyboard = (
  ctx: BotContext,
  options: ProfileCardNavigationOptions,
): InlineKeyboardMarkup | undefined => {
  const keyboard = buildInlineKeyboard([
    [
      { label: copy.back, action: options.backAction },
      { label: copy.home, action: options.homeAction },
    ],
  ]);

  return bindInlineKeyboardToUser(ctx, keyboard);
};

const isMessageNotModifiedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const description = (error as { description?: unknown }).description;
  if (typeof description === 'string' && description.includes('message is not modified')) {
    return true;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message === 'string' && message.includes('message is not modified')) {
    return true;
  }

  return false;
};

export const renderProfileCard = async (
  ctx: BotContext,
  options: ProfileCardNavigationOptions,
): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    if (ctx.callbackQuery) {
      try {
        await ctx.answerCbQuery('Карточка доступна только в личном чате.');
      } catch {
        // Ignore answer errors
      }
    } else if (ctx.chat) {
      try {
        await ctx.reply('Карточка доступна только в личном чате.');
      } catch {
        // Ignore send errors
      }
    }

    return;
  }

  const text = buildProfileCardText(ctx);
  const reply_markup = buildProfileCardKeyboard(ctx, options);

  const message = ctx.callbackQuery?.message;
  if (message && 'message_id' in message && typeof message.message_id === 'number') {
    try {
      await ctx.editMessageText(text, { reply_markup });
      return;
    } catch (error) {
      if (isMessageNotModifiedError(error)) {
        return;
      }
      // Fallback to sending a new message below
    }
  }

  await ctx.reply(text, { reply_markup });
};

export const renderProfileCardFromAction = async (
  ctx: BotContext,
  options: ProfileCardActionOptions,
): Promise<void> => {
  if (ctx.chat?.type === 'private' && ctx.callbackQuery) {
    try {
      await ctx.answerCbQuery();
    } catch (error) {
      options.onAnswerError?.(error);
    }
  }

  await renderProfileCard(ctx, options);
};

export const createProfileCardActionHandler = (
  options: ProfileCardActionOptions,
): ((ctx: BotContext) => Promise<void>) => {
  return async (ctx: BotContext) => {
    await renderProfileCardFromAction(ctx, options);
  };
};

export const __testing__ = {
  buildProfileCardKeyboard,
  isMessageNotModifiedError,
};
