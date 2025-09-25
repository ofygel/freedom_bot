import { Markup, type Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { CITIES_ORDER, CITY_LABEL, isAppCity, type AppCity } from '../../../domain/cities';
import { setUserCitySelected } from '../../../services/users';
import type { BotContext } from '../../types';
import { resetClientOrderDraft } from '../../services/orders';
import { bindInlineKeyboardToUser } from '../../services/callbackTokens';

export const CITY_ACTION_PATTERN = /^city:([a-z]+)$/i;

const buildCityKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard(
    CITIES_ORDER.map((city) => [Markup.button.callback(CITY_LABEL[city], `city:${city}`)]),
  ).reply_markup as InlineKeyboardMarkup;

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
  await ctx.reply(title, { reply_markup: replyMarkup });
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

    await setUserCitySelected(telegramId, city);
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

    if (typeof next === 'function') {
      await next();
    }
  });
};
