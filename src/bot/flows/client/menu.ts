import { Markup, Telegraf } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

import { logger } from '../../../config';
import type { BotContext } from '../../types';
import { START_DELIVERY_ORDER_ACTION } from './deliveryOrderFlow';
import { START_TAXI_ORDER_ACTION } from './taxiOrderFlow';
import { CLIENT_ORDERS_ACTION } from './orderActions';
import { ui } from '../../ui';

const ROLE_CLIENT_ACTION = 'role:client';
export const CLIENT_MENU_ACTION = 'client:menu:show';
const CLIENT_MENU_STEP_ID = 'client:menu:main';
const CLIENT_MENU_PRIVATE_WARNING_STEP_ID = 'client:menu:private-only';

const buildMenuKeyboard = (): InlineKeyboardMarkup =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🚕 Заказать такси', START_TAXI_ORDER_ACTION)],
    [Markup.button.callback('📦 Заказать доставку', START_DELIVERY_ORDER_ACTION)],
    [Markup.button.callback('📋 Мои заказы', CLIENT_ORDERS_ACTION)],
    [Markup.button.callback('🔄 Обновить меню', CLIENT_MENU_ACTION)],
  ]).reply_markup;

const buildMenuText = (): string =>
  [
    '🎯 Меню клиента',
    '',
    'Выберите, что хотите оформить:',
    '• 🚕 Такси — подача машины и поездка по указанному адресу.',
    '• 📦 Доставка — курьер заберёт и доставит вашу посылку.',
    '• 📋 Мои заказы — проверка статуса и управление оформленными заказами.',
  ].join('\n');

const removeRoleSelectionMessage = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  try {
    await ctx.deleteMessage();
    return;
  } catch (error) {
    logger.debug({ err: error, chatId: ctx.chat.id }, 'Failed to delete client role message');
  }

  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch (error) {
    logger.debug(
      { err: error, chatId: ctx.chat.id },
      'Failed to clear role selection keyboard for client',
    );
  }
};

const showMenu = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.answerCbQuery('Меню доступно только в личном чате с ботом.');
    return;
  }

  const keyboard = buildMenuKeyboard();
  const text = buildMenuText();

  await ui.step(ctx, {
    id: CLIENT_MENU_STEP_ID,
    text,
    keyboard,
    cleanup: false,
  });
};

export const registerClientMenu = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_CLIENT_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await showMenu(ctx);
      return;
    }

    await removeRoleSelectionMessage(ctx);

    try {
      await ctx.answerCbQuery();
    } catch (error) {
      logger.debug({ err: error }, 'Failed to answer client role callback');
    }

    await showMenu(ctx);
  });

  bot.action(CLIENT_MENU_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await showMenu(ctx);
      return;
    }

    try {
      await ctx.answerCbQuery();
    } catch (error) {
      logger.debug({ err: error }, 'Failed to answer client menu callback');
    }

    await showMenu(ctx);
  });

  bot.command('order', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ui.step(ctx, {
        id: CLIENT_MENU_PRIVATE_WARNING_STEP_ID,
        text: 'Меню доступно только в личном чате с ботом.',
        cleanup: true,
      });
      return;
    }

    await showMenu(ctx);
  });
};
