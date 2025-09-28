import type { Telegraf } from 'telegraf';

import type { BotContext } from '../../types';
import { SAFE_MODE_CARD_ACTIONS, buildSafeModeCardText } from '../../ui/safeModeCard';
import { askCity } from './citySelect';
import { promptClientSupport } from '../client/support';

const SAFE_MODE_PROFILE_ACTION = SAFE_MODE_CARD_ACTIONS.profile;
const SAFE_MODE_CITY_ACTION = SAFE_MODE_CARD_ACTIONS.city;
const SAFE_MODE_SUPPORT_ACTION = SAFE_MODE_CARD_ACTIONS.support;

const buildProfileSummary = (ctx: BotContext): string => {
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

export const isSafeModeSession = (ctx: BotContext): boolean =>
  ctx.session.safeMode === true
  || ctx.session.isDegraded === true
  || ctx.auth?.user.status === 'safe_mode';

export const registerSafeModeActions = (bot: Telegraf<BotContext>): void => {
  bot.action(SAFE_MODE_PROFILE_ACTION, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Ignore answer errors
    }

    if (ctx.chat?.type !== 'private') {
      if (ctx.chat) {
        try {
          await ctx.reply('Карточка доступна только в личном чате.');
        } catch {
          // Ignore
        }
      }
      return;
    }

    await ctx.reply(buildProfileSummary(ctx));
  });

  bot.action(SAFE_MODE_CITY_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.answerCbQuery('Сменить город можно только в личном чате.');
      } catch {
        // Ignore
      }
      return;
    }

    try {
      await ctx.answerCbQuery();
    } catch {
      // Ignore
    }

    await askCity(ctx, 'Смените город:');
  });

  bot.action(SAFE_MODE_SUPPORT_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      try {
        await ctx.answerCbQuery('Обратитесь в поддержку из личного чата.');
      } catch {
        // Ignore
      }
      return;
    }

    try {
      await ctx.answerCbQuery();
    } catch {
      // Ignore
    }

    await promptClientSupport(ctx);
  });
};

export const __testing__ = {
  buildSafeModeCardText,
  buildProfileSummary,
  SAFE_MODE_ACTIONS: SAFE_MODE_CARD_ACTIONS,
};
