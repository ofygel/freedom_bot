import { Markup, Telegraf } from 'telegraf';

import { getChannelBinding } from '../../../channels';
import { logger } from '../../../config';
import type { BotContext } from '../../types';
import { EXECUTOR_SUBSCRIPTION_ACTION, ensureExecutorState, showExecutorMenu } from './menu';
import { getExecutorRoleCopy } from './roleCopy';

const capitalise = (value: string): string =>
  value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;

export const registerExecutorSubscription = (bot: Telegraf<BotContext>): void => {
  bot.action(EXECUTOR_SUBSCRIPTION_ACTION, async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      await ctx.answerCbQuery('Доступно только в личных сообщениях.');
      return;
    }

    await ctx.answerCbQuery();
    const state = ensureExecutorState(ctx);
    const copy = getExecutorRoleCopy(state.role);
    const channelLabel = `канал ${copy.pluralGenitive}`;

    if (state.verification.status !== 'submitted') {
      const message = await ctx.reply('Сначала завершите проверку документов, чтобы получить ссылку на канал.');
      ctx.session.ephemeralMessages.push(message.message_id);
      return;
    }

    const binding = await getChannelBinding('drivers');
    if (!binding) {
      const message = await ctx.reply(
        `${capitalise(channelLabel)} пока не настроен. Попробуйте позже.`,
      );
      ctx.session.ephemeralMessages.push(message.message_id);
      return;
    }

    try {
      const invite = await ctx.telegram.createChatInviteLink(binding.chatId, {
        creates_join_request: true,
        name: `Executor onboarding ${ctx.from?.id ?? ''}`.trim(),
      });

      state.subscription.lastInviteLink = invite.invite_link;
      state.subscription.lastIssuedAt = Date.now();

      await ctx.reply(
        [
          `Отправьте заявку на вступление в ${channelLabel} Freedom Bot.`,
          'После одобрения вы будете получать новые заказы и уведомления о сменах.',
        ].join('\n'),
        Markup.inlineKeyboard([
          [Markup.button.url('Отправить заявку', invite.invite_link)],
        ]),
      );
    } catch (error) {
      logger.error(
        { err: error, chatId: binding.chatId, role: state.role },
        'Failed to create executor channel invite link',
      );
      const message = await ctx.reply('Не удалось создать ссылку на канал. Попробуйте позже.');
      ctx.session.ephemeralMessages.push(message.message_id);
      return;
    }

    await showExecutorMenu(ctx);
  });
};
