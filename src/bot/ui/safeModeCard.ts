import type { BotContext } from '../types';
import { ui } from '../ui';
import { buildInlineKeyboard } from '../keyboards/common';

export const SAFE_MODE_CARD_STEP_ID = 'common:safe-mode:card';

const SAFE_MODE_PROFILE_ACTION = 'safe-mode:profile';
const SAFE_MODE_CITY_ACTION = 'safe-mode:city';
const SAFE_MODE_SUPPORT_ACTION = 'safe-mode:support';

export const SAFE_MODE_CARD_ACTIONS = {
  profile: SAFE_MODE_PROFILE_ACTION,
  city: SAFE_MODE_CITY_ACTION,
  support: SAFE_MODE_SUPPORT_ACTION,
} as const;

const buildSafeModeKeyboard = () =>
  buildInlineKeyboard([
    [
      { label: 'Профиль', action: SAFE_MODE_PROFILE_ACTION },
      { label: 'Сменить город', action: SAFE_MODE_CITY_ACTION },
    ],
    [{ label: 'Помощь', action: SAFE_MODE_SUPPORT_ACTION }],
  ]);

export const buildSafeModeCardText = (prompt?: string): string => {
  const lines = [
    '⚠️ Freedom Bot работает в безопасном режиме — часть функций недоступна.',
    prompt ?? 'Пока доступны только базовые действия: [Профиль], [Сменить город], [Помощь].',
    '',
    '• Профиль — посмотрите актуальные данные аккаунта.',
    '• Сменить город — уточните рабочий город.',
    '• Помощь — свяжитесь с поддержкой.',
  ];

  return lines.join('\n');
};

export interface ShowSafeModeCardOptions {
  prompt?: string;
}

export const showSafeModeCard = async (
  ctx: BotContext,
  options: ShowSafeModeCardOptions = {},
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

export const __testing__ = {
  buildSafeModeCardText,
  SAFE_MODE_CARD_ACTIONS,
};
