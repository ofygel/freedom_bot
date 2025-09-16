import crypto from 'crypto';

import { Markup, Telegraf, Telegram } from 'telegraf';
import type { ExtraEditMessageText, ExtraReplyMessage } from 'telegraf/typings/telegram-types';

import { getChannelBinding, type ChannelType } from '../../channels';
import { logger } from '../../config';
import type { BotContext } from '../types';

const DEFAULT_REJECTION_PLACEHOLDER = 'без указания причины';

const formatModerator = (
  moderator: ModeratorInfo,
): string => {
  if (moderator.username) {
    return `@${moderator.username}`;
  }

  const fullName = [moderator.firstName, moderator.lastName]
    .filter((value) => Boolean(value && value.trim().length > 0))
    .join(' ') // separator only between provided parts
    .trim();

  if (fullName) {
    return `${fullName}${moderator.id ? ` (ID ${moderator.id})` : ''}`;
  }

  return moderator.id ? `ID ${moderator.id}` : 'неизвестный модератор';
};

const normaliseReason = (reason?: string): string => {
  const trimmed = reason?.trim();
  if (trimmed) {
    return trimmed;
  }

  return DEFAULT_REJECTION_PLACEHOLDER;
};

const createToken = (): string => crypto.randomBytes(8).toString('hex');

const pickFormatOptions = (
  options?: ExtraReplyMessage,
): MessageFormatOptions | undefined => {
  if (!options) {
    return undefined;
  }

  const formatOptions: MessageFormatOptions = {};
  if (options.parse_mode) {
    formatOptions.parse_mode = options.parse_mode;
  }
  if (options.link_preview_options) {
    formatOptions.link_preview_options = options.link_preview_options;
  }

  return Object.keys(formatOptions).length > 0 ? formatOptions : undefined;
};

const applyFormatOptions = (
  options: MessageFormatOptions | undefined,
): Pick<ExtraEditMessageText, 'parse_mode' | 'link_preview_options'> => ({
  parse_mode: options?.parse_mode,
  link_preview_options: options?.link_preview_options,
});

const buildDecisionSuffix = (
  decision: ModerationDecision,
  moderator: ModeratorInfo,
  reason?: string,
): string => {
  const moderatorLabel = formatModerator(moderator);
  if (decision === 'approved') {
    return `✅ Одобрено модератором ${moderatorLabel}.`;
  }

  const cause = normaliseReason(reason);
  return `❌ Отклонено модератором ${moderatorLabel}. Причина: ${cause}.`;
};

const buildAlreadyProcessedResponse = (
  state: PendingModerationItem<any>,
): string => {
  if (state.decision?.status === 'approved') {
    const moderatorLabel = state.decision.moderator
      ? formatModerator(state.decision.moderator)
      : 'другим модератором';
    return `Заявка уже одобрена ${moderatorLabel}.`;
  }

  if (state.decision?.status === 'rejected') {
    const moderatorLabel = state.decision.moderator
      ? formatModerator(state.decision.moderator)
      : 'другим модератором';
    const cause = normaliseReason(state.decision.reason);
    return `Заявка уже отклонена ${moderatorLabel}. Причина: ${cause}.`;
  }

  return 'Заявка уже обработана.';
};

const ensureArray = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

const buildMessageKeyboard = (
  token: string,
  reasons: string[],
  acceptAction: string,
  rejectAction: string,
) => {
  const rows = [
    [Markup.button.callback('✅ Одобрить', `${acceptAction}:${token}`)],
  ];

  reasons.forEach((reason, index) => {
    const trimmed = reason.trim();
    const label = trimmed ? `❌ ${trimmed}` : '❌ Отклонить';
    rows.push([
      Markup.button.callback(label, `${rejectAction}:${token}:${index.toString(10)}`),
    ]);
  });

  if (reasons.length === 0) {
    rows.push([Markup.button.callback('❌ Отклонить', `${rejectAction}:${token}:0`)]);
  }

  return Markup.inlineKeyboard(rows);
};

const toModeratorInfo = (from?: BotContext['from']): ModeratorInfo => ({
  id: from?.id,
  username: from?.username ?? undefined,
  firstName: from?.first_name ?? undefined,
  lastName: from?.last_name ?? undefined,
});

interface MessageFormatOptions {
  parse_mode?: ExtraReplyMessage['parse_mode'];
  link_preview_options?: ExtraReplyMessage['link_preview_options'];
}

interface PendingModerationItem<T> {
  token: string;
  item: T;
  status: ModerationDecision | 'pending';
  message: {
    chatId: number;
    messageId: number;
    text: string;
    formatOptions?: MessageFormatOptions;
  };
  rejectionReasons: string[];
  decision?: {
    status: ModerationDecision;
    moderator?: ModeratorInfo;
    reason?: string;
    decidedAt: number;
  };
}

export type ModerationDecision = 'approved' | 'rejected';

export interface ModeratorInfo {
  id?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export interface ModerationDecisionContext<T> {
  item: T;
  moderator: ModeratorInfo;
  decidedAt: number;
}

export interface ModerationRejectionContext<T> extends ModerationDecisionContext<T> {
  reason: string;
}

export interface ModerationQueueItemBase<TContext = unknown> {
  id: string | number;
  /**
   * Optional list of rejection reasons to render in the inline keyboard.
   * When omitted, defaults from the queue configuration are used.
   */
  rejectionReasons?: string[];
  /**
   * Additional options to pass to `sendMessage` when publishing the item.
   */
  messageOptions?: ExtraReplyMessage;
  /**
   * Callback invoked after the item has been approved by a moderator.
   */
  onApprove?: (context: ModerationDecisionContext<TContext>) => void | Promise<void>;
  /**
   * Callback invoked after the item has been rejected by a moderator.
   */
  onReject?: (context: ModerationRejectionContext<TContext>) => void | Promise<void>;
}

export interface PublishModerationResult {
  status: 'published' | 'missing_channel';
  chatId?: number;
  messageId?: number;
  token?: string;
}

export interface ModerationQueueConfig<T extends ModerationQueueItemBase<T>> {
  /**
   * Unique identifier for the queue, used in callback data and logging.
   */
  type: string;
  /**
   * Channel binding type where items should be published.
   */
  channelType: ChannelType;
  /**
   * Fallback rejection reasons if none are provided by the published item.
   */
  defaultRejectionReasons: string[];
  /**
   * Function that renders a human-readable message for the moderation item.
   */
  renderMessage: (item: T) => string | string[];
}

export interface ModerationQueue<T extends ModerationQueueItemBase<T>> {
  publish: (telegram: Telegram, item: T) => Promise<PublishModerationResult>;
  register: (bot: Telegraf<BotContext>) => void;
}

export const createModerationQueue = <T extends ModerationQueueItemBase<T>>( 
  config: ModerationQueueConfig<T>,
): ModerationQueue<T> => {
  const acceptAction = `mod:${config.type}:accept`;
  const rejectAction = `mod:${config.type}:reject`;
  const state = new Map<string, PendingModerationItem<T>>();

  const publish = async (telegram: Telegram, item: T): Promise<PublishModerationResult> => {
    const binding = await getChannelBinding(config.channelType);
    if (!binding) {
      logger.warn(
        { queue: config.type, itemId: item.id },
        'Target moderation channel is not configured, skipping publish',
      );
      return { status: 'missing_channel' };
    }

    const messageText = ensureArray(config.renderMessage(item)).join('\n');
    const rejectionReasons =
      item.rejectionReasons && item.rejectionReasons.length > 0
        ? item.rejectionReasons
        : config.defaultRejectionReasons;

    const token = createToken();
    const keyboard = buildMessageKeyboard(token, rejectionReasons, acceptAction, rejectAction);
    const message = await telegram.sendMessage(binding.chatId, messageText, {
      ...item.messageOptions,
      reply_markup: keyboard.reply_markup,
    });

    state.set(token, {
      token,
      item,
      status: 'pending',
      message: {
        chatId: binding.chatId,
        messageId: message.message_id,
        text: messageText,
        formatOptions: pickFormatOptions(item.messageOptions),
      },
      rejectionReasons,
    });

    return {
      status: 'published',
      chatId: binding.chatId,
      messageId: message.message_id,
      token,
    } satisfies PublishModerationResult;
  };

  const updateMessage = async (
    telegram: Telegram,
    entry: PendingModerationItem<T>,
    decision: ModerationDecision,
    moderator: ModeratorInfo,
    reason?: string,
  ): Promise<void> => {
    const suffix = buildDecisionSuffix(decision, moderator, reason);
    const newText = `${entry.message.text}\n\n${suffix}`.trim();

    try {
      await telegram.editMessageText(
        entry.message.chatId,
        entry.message.messageId,
        undefined,
        newText,
        {
          ...applyFormatOptions(entry.message.formatOptions),
          reply_markup: { inline_keyboard: [] },
        },
      );
    } catch (error) {
      logger.warn(
        {
          err: error,
          queue: config.type,
          chatId: entry.message.chatId,
          messageId: entry.message.messageId,
        },
        'Failed to update moderation message after decision',
      );
    }
  };

  const resolveDecision = async (
    ctx: BotContext,
    token: string,
    decision: ModerationDecision,
    reason?: string,
  ): Promise<void> => {
    const entry = state.get(token);
    if (!entry) {
      await ctx.answerCbQuery('Не удалось найти заявку. Вероятно, она уже обработана.');
      return;
    }

    if (entry.status !== 'pending') {
      await ctx.answerCbQuery(buildAlreadyProcessedResponse(entry));
      return;
    }

    const moderator = toModeratorInfo(ctx.from);
    const decidedAt = Date.now();

    entry.status = decision;
    entry.decision = {
      status: decision,
      moderator,
      reason,
      decidedAt,
    };

    await updateMessage(ctx.telegram, entry, decision, moderator, reason);

    try {
      if (decision === 'approved') {
        await entry.item.onApprove?.({
          item: entry.item,
          moderator,
          decidedAt,
        } as ModerationDecisionContext<T>);
      } else {
        await entry.item.onReject?.({
          item: entry.item,
          moderator,
          decidedAt,
          reason: normaliseReason(reason),
        } as ModerationRejectionContext<T>);
      }
    } catch (callbackError) {
      logger.error(
        { err: callbackError, queue: config.type, itemId: entry.item.id },
        'Error while running moderation decision callback',
      );
    }

    const responseMessage =
      decision === 'approved'
        ? 'Заявка одобрена.'
        : `Заявка отклонена (${normaliseReason(reason)}).`;
    await ctx.answerCbQuery(responseMessage);
  };

  const register = (bot: Telegraf<BotContext>): void => {
    const acceptPattern = new RegExp(`^${acceptAction}:([a-f0-9]+)$`);
    const rejectPattern = new RegExp(`^${rejectAction}:([a-f0-9]+):(\d+)$`);

    bot.action(acceptPattern, async (ctx) => {
      const match = ctx.match as RegExpMatchArray | undefined;
      const token = match?.[1];
      if (!token) {
        await ctx.answerCbQuery('Некорректное действие.');
        return;
      }

      await resolveDecision(ctx, token, 'approved');
    });

    bot.action(rejectPattern, async (ctx) => {
      const match = ctx.match as RegExpMatchArray | undefined;
      const token = match?.[1];
      const indexText = match?.[2];
      if (!token || !indexText) {
        await ctx.answerCbQuery('Некорректное действие.');
        return;
      }

      const entry = state.get(token);
      const index = Number.parseInt(indexText, 10);
      const reason = entry?.rejectionReasons?.[index];
      await resolveDecision(ctx, token, 'rejected', reason);
    });
  };

  return {
    publish,
    register,
  } satisfies ModerationQueue<T>;
};
