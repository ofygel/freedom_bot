import type { Telegraf } from 'telegraf';

import type { BotContext } from '../../types';
import { ui } from '../../ui';
import { buildInlineKeyboard } from '../../keyboards/common';
import { askCity } from './citySelect';
import { promptClientSupport } from '../client/support';

export const SAFE_MODE_CARD_STEP_ID = 'common:safe-mode:card';

const SAFE_MODE_PROFILE_ACTION = 'safe-mode:profile';
const SAFE_MODE_CITY_ACTION = 'safe-mode:city';
const SAFE_MODE_SUPPORT_ACTION = 'safe-mode:support';

const SAFE_MODE_ACTIONS = {
  profile: SAFE_MODE_PROFILE_ACTION,
  city: SAFE_MODE_CITY_ACTION,
  support: SAFE_MODE_SUPPORT_ACTION,
} as const;

const buildSafeModeKeyboard = () =>
  buildInlineKeyboard([
    [
      { label: '👤 Профиль', action: SAFE_MODE_PROFILE_ACTION },
      { label: '🏙️ Сменить город', action: SAFE_MODE_CITY_ACTION },
    ],
    [{ label: '🆘 Помощь', action: SAFE_MODE_SUPPORT_ACTION }],
  ]);

const buildSafeModeCardText = (prompt?: string): string => {
  const lines = [
    '⚠️ Freedom Bot работает в безопасном режиме — часть функций недоступна.',
    prompt ?? 'Пока доступны только базовые действия ниже:',
    '',
    '• 👤 Профиль — посмотрите актуальные данные аккаунта.',
    '• 🏙️ Сменить город — уточните рабочий город.',
    '• 🆘 Помощь — свяжитесь с поддержкой.',
  ];

  return lines.join('\n');
};

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
  ctx.session.safeMode === true || ctx.auth?.user.status === 'safe_mode';

export const showSafeModeCard = async (
  ctx: BotContext,
  options: { prompt?: string } = {},
): Promise<void> => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    return;
  }

  await ui.step(ctx, {
    id: SAFE_MODE_CARD_STEP_ID,
    text: buildSafeModeCardText(options.prompt),
    keyboard: buildSafeModeKeyboard(),
    cleanup: false,
  });
};

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
  SAFE_MODE_ACTIONS,
};
