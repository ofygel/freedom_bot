import { Markup, Telegraf } from 'telegraf';

import { logger } from '../../../config';
import type { BotContext } from '../../types';
import { START_DELIVERY_ORDER_ACTION } from './deliveryOrderFlow';
import { START_TAXI_ORDER_ACTION } from './taxiOrderFlow';

const ROLE_CLIENT_ACTION = 'role:client';
const CLIENT_MENU_ACTION = 'client:menu:show';

const buildMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('🚕 Заказать такси', START_TAXI_ORDER_ACTION)],
    [Markup.button.callback('📦 Заказать доставку', START_DELIVERY_ORDER_ACTION)],
    [Markup.button.callback('🔄 Обновить меню', CLIENT_MENU_ACTION)],
  ]);

const buildMenuText = (): string =>
  [
    '🎯 Меню клиента Freedom Bot',
    '',
    'Выберите, что хотите оформить:',
    '• 🚕 Такси — подача машины и поездка по указанному адресу.',
    '• 📦 Доставка — курьер заберёт и доставит вашу посылку.',
  ].join('\n');

const showMenu = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    await ctx.answerCbQuery('Меню доступно только в личном чате с ботом.');
    return;
  }

  const keyboard = buildMenuKeyboard();
  const text = buildMenuText();
  const chatId = ctx.chat.id;
  const state = ctx.session.client;

  if (state.menuMessageId) {
    try {
      await ctx.telegram.editMessageText(chatId, state.menuMessageId, undefined, text, {
        reply_markup: keyboard.reply_markup,
      });
      await ctx.answerCbQuery();
      return;
    } catch (error) {
      logger.debug(
        { err: error, chatId, messageId: state.menuMessageId },
        'Failed to update client menu message, sending a new one',
      );
      state.menuMessageId = undefined;
    }
  }

  const message = await ctx.reply(text, keyboard);
  state.menuMessageId = message.message_id;
  await ctx.answerCbQuery();
};

export const registerClientMenu = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_CLIENT_ACTION, async (ctx) => {
    if (ctx.chat?.type === 'private') {
      try {
        await ctx.editMessageReplyMarkup(undefined);
      } catch (error) {
        logger.debug(
          { err: error, chatId: ctx.chat?.id },
          'Failed to clear role selection keyboard for client',
        );
      }
    }

    await showMenu(ctx);
  });

  bot.action(CLIENT_MENU_ACTION, async (ctx) => {
    await showMenu(ctx);
  });

  bot.command('order', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.reply('Меню доступно только в личном чате с ботом.');
      return;
    }

    const state = ctx.session.client;
    state.menuMessageId = undefined;

    const keyboard = buildMenuKeyboard();
    const text = buildMenuText();
    const message = await ctx.reply(text, keyboard);
    state.menuMessageId = message.message_id;
  });
};
