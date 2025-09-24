import { Telegraf } from 'telegraf';

import { logger } from '../../../config';
import { ensureClientRole } from '../../../db/users';
import {
  CLIENT_MENU,
  clientMenuText,
  hideClientMenu,
  isClientChat,
  sendClientMenu,
} from '../../../ui/clientMenu';
import { CITY_LABEL } from '../../../domain/cities';
import { CLIENT_COMMANDS } from '../../commands/sets';
import { setChatCommands } from '../../services/commands';
import type { BotContext } from '../../types';
import { presentRoleSelection } from '../../commands/start';
import { promptClientSupport } from './support';
import { askCity, getCityFromContext, CITY_ACTION_PATTERN } from '../common/citySelect';

const ROLE_CLIENT_ACTION = 'role:client';
export const CLIENT_MENU_ACTION = 'client:menu:show';
const CLIENT_MENU_CITY_ACTION = 'clientMenu' as const;

const applyClientCommands = async (ctx: BotContext): Promise<void> => {
  if (ctx.chat?.type !== 'private') {
    return;
  }

  await setChatCommands(ctx.telegram, ctx.chat.id, CLIENT_COMMANDS, { showMenuButton: true });
};

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

const applyClientRole = async (ctx: BotContext): Promise<void> => {
  const authUser = ctx.auth.user;

  const username = ctx.from?.username ?? authUser.username;
  const firstName = ctx.from?.first_name ?? authUser.firstName;
  const lastName = ctx.from?.last_name ?? authUser.lastName;
  const sessionPhone = ctx.session.phoneNumber;
  const authPhone = authUser.phone;
  const phone = sessionPhone ?? authPhone;

  const shouldEnsureRole = authUser.role !== 'client';
  const shouldUpdatePhone = Boolean(phone && authPhone !== phone);

  if (shouldEnsureRole || shouldUpdatePhone) {
    try {
      await ensureClientRole({
        telegramId: authUser.telegramId,
        username: username ?? undefined,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
      });
    } catch (error) {
      logger.error(
        { err: error, telegramId: authUser.telegramId },
        'Failed to update client role in database',
      );
    }
  }

  authUser.role = 'client';
  authUser.status = 'active_client';
  authUser.username = username ?? undefined;
  authUser.firstName = firstName ?? undefined;
  authUser.lastName = lastName ?? undefined;
  if (phone) {
    authUser.phone = phone;
  }
  ctx.auth.isModerator = false;

  ctx.session.isAuthenticated = true;
  ctx.session.user = {
    id: authUser.telegramId,
    username: username ?? undefined,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
  };
  if (phone && !ctx.session.phoneNumber) {
    ctx.session.phoneNumber = phone;
  }
};

const showMenu = async (ctx: BotContext, prompt?: string): Promise<void> => {
  const role = ctx.auth?.user.role;
  if (!isClientChat(ctx, role)) {
    if (ctx.callbackQuery) {
      try {
        await ctx.answerCbQuery('Меню доступно только в личном чате с ботом.');
      } catch (error) {
        logger.debug({ err: error }, 'Failed to answer menu callback for non-private chat');
      }
    } else if (typeof ctx.reply === 'function') {
      await ctx.reply('Меню доступно только в личном чате с ботом.');
    }
    return;
  }

  const uiState = ctx.session.ui;

  const city = getCityFromContext(ctx);
  if (!city) {
    uiState.pendingCityAction = CLIENT_MENU_CITY_ACTION;
    await askCity(ctx, 'Укажите город, чтобы продолжить.');
    return;
  }

  uiState.pendingCityAction = undefined;
  const cityLabel = CITY_LABEL[city];
  await sendClientMenu(ctx, prompt ?? clientMenuText(cityLabel));
};

export const registerClientMenu = (bot: Telegraf<BotContext>): void => {
  bot.action(ROLE_CLIENT_ACTION, async (ctx) => {
    await applyClientRole(ctx);

    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      await showMenu(ctx);
      return;
    }

    await removeRoleSelectionMessage(ctx);

    await applyClientCommands(ctx);

    try {
      await ctx.answerCbQuery();
    } catch (error) {
      logger.debug({ err: error }, 'Failed to answer client role callback');
    }

    await showMenu(ctx, 'Добро пожаловать! Чем можем помочь?');
  });

  bot.action(CLIENT_MENU_ACTION, async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
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

  bot.action(CITY_ACTION_PATTERN, async (ctx, next) => {
    if (ctx.session.ui?.pendingCityAction === CLIENT_MENU_CITY_ACTION) {
      ctx.session.ui.pendingCityAction = undefined;

      if (isClientChat(ctx, ctx.auth?.user.role)) {
        await showMenu(ctx);
      }
    }

    if (typeof next === 'function') {
      await next();
    }
  });

  bot.command('order', async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      await ctx.reply('Меню доступно только в личном чате с ботом.');
      return;
    }

    await showMenu(ctx);
  });

  bot.command('support', async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      await ctx.reply('Поддержка доступна только в личном чате с ботом.');
      return;
    }

    await promptClientSupport(ctx);
  });

  bot.command('role', async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      await ctx.reply('Смена роли доступна только в личном чате с ботом.');
      return;
    }

    await hideClientMenu(ctx, 'Меняем роль — выберите подходящий вариант ниже.');
    await presentRoleSelection(ctx);
  });

  bot.hears(CLIENT_MENU.refresh, async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      return;
    }

    await sendClientMenu(ctx, 'Меню обновлено.');
  });

  bot.hears(CLIENT_MENU.support, async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      return;
    }

    await promptClientSupport(ctx);
  });

  bot.hears(CLIENT_MENU.city, async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      return;
    }

    await askCity(ctx, 'Выберите город:');
  });

  bot.hears(CLIENT_MENU.switchRole, async (ctx) => {
    if (!isClientChat(ctx, ctx.auth?.user.role)) {
      return;
    }

    await hideClientMenu(ctx, 'Меняем роль — выберите подходящий вариант ниже.');
    await presentRoleSelection(ctx);
  });
};
