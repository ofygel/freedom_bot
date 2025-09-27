import { Markup, type Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { CITIES_ORDER, CITY_LABEL, isAppCity, type AppCity } from '../../../domain/cities';
import { CitySelectionError, setUserCitySelected } from '../../../services/users';
import { logger } from '../../../config';
import type { BotContext } from '../../types';
import { resetClientOrderDraft } from '../../services/orders';
import { bindInlineKeyboardToUser } from '../../services/callbackTokens';
import { ui } from '../../ui';
import { copy } from '../../copy';

export const CITY_CONFIRM_STEP_ID = 'common:city:confirm';

const CLIENT_MENU_HOME_ACTION = 'client:menu:show';
const EXECUTOR_MENU_HOME_ACTION = 'executor:menu:refresh';

export const CITY_ACTION_PATTERN = /^city:([a-z]+)$/i;

const buildCityKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard(
    CITIES_ORDER.map((city) => [Markup.button.callback(CITY_LABEL[city], `city:${city}`)]),
  ).reply_markup as InlineKeyboardMarkup;

const resolveHomeAction = (ctx: BotContext): string => {
  const pending = ctx.session.ui?.pendingCityAction;
  if (pending === 'clientMenu') {
    return CLIENT_MENU_HOME_ACTION;
  }
  if (pending === 'executorMenu') {
    return EXECUTOR_MENU_HOME_ACTION;
  }

  const role = ctx.auth?.user.role;
  if (role === 'client' || role === 'guest' || role === 'moderator') {
    return CLIENT_MENU_HOME_ACTION;
  }

  return EXECUTOR_MENU_HOME_ACTION;
};

const applyCitySelection = (ctx: BotContext, city: AppCity): void => {
  const previousCity = ctx.auth.user.citySelected;
  ctx.auth.user.citySelected = city;

  if (ctx.chat?.type === 'private') {
    ctx.session.city = city;
  }

  if (previousCity && previousCity !== city && ctx.session?.client) {
    resetClientOrderDraft(ctx.session.client.taxi);
    resetClientOrderDraft(ctx.session.client.delivery);
  }
};

export const getCityFromContext = (ctx: BotContext): AppCity | undefined => {
  if (ctx.auth.user.citySelected) {
    return ctx.auth.user.citySelected;
  }

  return ctx.chat?.type === 'private' ? ctx.session.city ?? undefined : undefined;
};

export const askCity = async (
  ctx: BotContext,
  title = 'Выберите город, чтобы продолжить работу с ботом:',
): Promise<void> => {
  if (!ctx.chat) {
    return;
  }

  const keyboard = buildCityKeyboard();
  const replyMarkup = bindInlineKeyboardToUser(ctx, keyboard) ?? keyboard;
  try {
    await ctx.reply(title, { reply_markup: replyMarkup });
  } catch (error) {
    if (!ctx.chat?.id) {
      throw error;
    }

    try {
      await ctx.telegram.sendMessage(ctx.chat.id, title, { reply_markup: replyMarkup });
    } catch {
      throw error;
    }
  }
};

export const ensureCitySelected = async (
  ctx: BotContext,
  title?: string,
): Promise<AppCity | null> => {
  const city = getCityFromContext(ctx);
  if (city) {
    return city;
  }

  await askCity(ctx, title);
  return null;
};

export const registerCityAction = (bot: Telegraf<BotContext>): void => {
  bot.action(CITY_ACTION_PATTERN, async (ctx, next) => {
    const match = ctx.match;
    const slug = Array.isArray(match) ? match[1] : undefined;
    if (!slug || !isAppCity(slug)) {
      await ctx.answerCbQuery('Неизвестный город.');
      return;
    }

    const city = slug as AppCity;
    const telegramId = ctx.from?.id;
    if (!telegramId) {
      await ctx.answerCbQuery('Не удалось определить пользователя.');
      return;
    }

    try {
      await setUserCitySelected(telegramId, city);
    } catch (error) {
      if (error instanceof CitySelectionError) {
        await ctx.answerCbQuery(copy.serviceUnavailable, { show_alert: true });
        if (ctx.chat?.id) {
          try {
            await ctx.reply('Техническая ошибка, попробуйте позже');
          } catch (replyError) {
            logger.warn(
              { err: replyError, chatId: ctx.chat.id },
              'Failed to notify user about city selection error',
            );
            if (ctx.telegram?.sendMessage) {
              try {
                await ctx.telegram.sendMessage(ctx.chat.id, 'Техническая ошибка, попробуйте позже');
              } catch (sendError) {
                logger.error(
                  { err: sendError, chatId: ctx.chat.id },
                  'Failed to send city selection error notification',
                );
              }
            }
          }
        }
        return;
      }

      throw error;
    }
    applyCitySelection(ctx, city);

    await ctx.answerCbQuery(`Город: ${CITY_LABEL[city]}`);

    try {
      await ctx.editMessageText(`Город установлен: ${CITY_LABEL[city]}`);
    } catch {
      try {
        await ctx.reply(`Город установлен: ${CITY_LABEL[city]}`);
      } catch {
        // Ignore message errors, selection is already stored.
      }
    }

    await ui.trackStep(ctx, {
      id: CITY_CONFIRM_STEP_ID,
      homeAction: resolveHomeAction(ctx),
    });

    if (typeof next === 'function') {
      await next();
    }
  });
};
