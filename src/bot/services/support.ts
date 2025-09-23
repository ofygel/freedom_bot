import crypto from 'crypto';

import { Markup, Telegraf } from 'telegraf';
import type {
  ForceReply,
  InlineKeyboardMarkup,
  Message,
} from 'telegraf/typings/core/types/typegram';
import type { ExtraCopyMessage } from 'telegraf/typings/telegram-types';

import { logger } from '../../config';
import { pool } from '../../db';
import { getChannelBinding } from '../channels/bindings';
import type { BotContext } from '../types';
import { safeEditReplyMarkup } from '../../utils/tg';

export interface SupportContact {
  type: 'phone' | 'email' | 'telegram' | 'link';
  value: string;
  label?: string;
  description?: string;
  url?: string;
}

export interface SupportMessageOptions {
  title?: string;
  description?: string | string[];
  contacts?: SupportContact[];
  footer?: string | string[];
}

const normaliseLines = (input?: string | string[]): string[] => {
  if (!input) {
    return [];
  }

  return Array.isArray(input) ? input : [input];
};

const buildContactLine = (contact: SupportContact): string => {
  const label = contact.label?.trim();

  switch (contact.type) {
    case 'phone':
      return `📞 ${label ?? 'Телефон'}: ${contact.value}`;
    case 'email':
      return `✉️ ${label ?? 'Email'}: ${contact.value}`;
    case 'telegram':
      return `💬 ${label ?? 'Telegram'}: ${contact.value.startsWith('@') ? contact.value : `@${contact.value}`}`;
    case 'link':
    default:
      return `${label ?? '🔗 Ссылка'}: ${contact.value}`;
  }
};

export const buildSupportMessage = (options: SupportMessageOptions = {}): string => {
  const lines: string[] = [];

  if (options.title) {
    lines.push(options.title.trim());
  } else {
    lines.push('🆘 Поддержка');
  }

  const description = normaliseLines(options.description);
  if (description.length > 0) {
    lines.push('');
    lines.push(...description);
  }

  if (options.contacts && options.contacts.length > 0) {
    lines.push('');
    lines.push('Свяжитесь с нами:');
    options.contacts.forEach((contact) => {
      const line = buildContactLine(contact);
      lines.push(line);
      if (contact.description) {
        lines.push(`• ${contact.description.trim()}`);
      }
    });
  }

  const footer = normaliseLines(options.footer);
  if (footer.length > 0) {
    lines.push('');
    lines.push(...footer);
  }

  return lines.join('\n');
};

export const buildSupportKeyboard = (
  contacts: SupportContact[] = [],
): InlineKeyboardMarkup | undefined => {
  const buttons = contacts
    .filter((contact) => Boolean(contact.url))
    .map((contact) => [
      Markup.button.url(contact.label ?? contact.value, contact.url as string),
    ]);

  if (buttons.length === 0) {
    return undefined;
  }

  return Markup.inlineKeyboard(buttons).reply_markup;
};

type SupportThreadStatus = 'open' | 'closed';

interface SupportThreadState {
  id: string;
  userChatId: number;
  userTelegramId?: number;
  userMessageId: number;
  moderatorChatId: number;
  moderatorMessageId: number;
  status: SupportThreadStatus;
}

interface SupportThreadRow {
  id: string;
  user_chat_id: number | string;
  user_tg_id: number | string | null;
  user_message_id: number;
  moderator_chat_id: number | string;
  moderator_message_id: number;
  status: SupportThreadStatus;
  closed_at: Date | string | null;
}

interface SupportThreadPrompt {
  threadId: string;
  chatId: number;
  messageId: number;
  moderatorId?: number;
}

const parseNumeric = (value: string | number | null | undefined): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const REPLY_ACTION_PREFIX = 'support:reply';
const CLOSE_ACTION_PREFIX = 'support:close';
const REPLY_ACTION_PATTERN = /^support:reply:([\da-f-]+)$/;
const CLOSE_ACTION_PATTERN = /^support:close:([\da-f-]+)$/;

const threadsById = new Map<string, SupportThreadState>();
const threadsByModeratorMessage = new Map<string, string>();
const pendingReplyPrompts = new Map<string, SupportThreadPrompt>();
const promptsByThread = new Map<string, Set<string>>();
const promptsByModerator = new Map<string, string>();

const extractTelegramErrorDescription = (error: unknown): string | undefined => {
  const telegramError = error as {
    description?: string;
    message?: string;
    response?: { description?: string };
  };

  return (
    telegramError?.response?.description ??
    telegramError?.description ??
    telegramError?.message
  );
};

const isInlineKeyboardExpectedError = (error: unknown): boolean => {
  const description = extractTelegramErrorDescription(error);
  return Boolean(description && /inline keyboard expected/i.test(description));
};

const mapThreadRowToState = (row: SupportThreadRow): SupportThreadState | null => {
  const userChatId = parseNumeric(row.user_chat_id);
  const moderatorChatId = parseNumeric(row.moderator_chat_id);
  const userTelegramId = parseNumeric(row.user_tg_id);

  if (
    userChatId === undefined ||
    moderatorChatId === undefined ||
    typeof row.user_message_id !== 'number' ||
    typeof row.moderator_message_id !== 'number'
  ) {
    return null;
  }

  return {
    id: row.id,
    userChatId,
    userTelegramId,
    userMessageId: row.user_message_id,
    moderatorChatId,
    moderatorMessageId: row.moderator_message_id,
    status: row.status,
  } satisfies SupportThreadState;
};

type ModerationChannelResolver = () => Promise<number | null>;

const defaultResolveModerationChannel: ModerationChannelResolver = async () => {
  const binding = await getChannelBinding('verify');
  return binding?.chatId ?? null;
};

let resolveModerationChannel: ModerationChannelResolver =
  defaultResolveModerationChannel;

const createThreadId = (): string => crypto.randomBytes(8).toString('hex');

const buildMessageKey = (chatId: number, messageId: number): string =>
  `${chatId.toString(10)}:${messageId.toString(10)}`;

const buildModeratorPromptKey = (chatId: number, moderatorId: number): string =>
  `${chatId.toString(10)}:${moderatorId.toString(10)}`;

const registerPrompt = (
  threadId: string,
  chatId: number,
  messageId: number,
  moderatorId?: number,
): void => {
  const key = buildMessageKey(chatId, messageId);
  pendingReplyPrompts.set(key, { threadId, chatId, messageId, moderatorId });

  if (moderatorId !== undefined) {
    const moderatorKey = buildModeratorPromptKey(chatId, moderatorId);
    promptsByModerator.set(moderatorKey, key);
  }

  let entries = promptsByThread.get(threadId);
  if (!entries) {
    entries = new Set<string>();
    promptsByThread.set(threadId, entries);
  }

  entries.add(key);
};

const clearPrompt = (key: string): void => {
  const prompt = pendingReplyPrompts.get(key);
  if (!prompt) {
    return;
  }

  pendingReplyPrompts.delete(key);

  if (prompt.moderatorId !== undefined) {
    const moderatorKey = buildModeratorPromptKey(prompt.chatId, prompt.moderatorId);
    const storedKey = promptsByModerator.get(moderatorKey);
    if (storedKey === key) {
      promptsByModerator.delete(moderatorKey);
    }
  }

  const entries = promptsByThread.get(prompt.threadId);
  if (!entries) {
    return;
  }

  entries.delete(key);
  if (entries.size === 0) {
    promptsByThread.delete(prompt.threadId);
  }
};

const clearPromptsForThread = (threadId: string): void => {
  const entries = promptsByThread.get(threadId);
  if (!entries) {
    return;
  }

  for (const key of entries) {
    const prompt = pendingReplyPrompts.get(key);
    if (prompt?.moderatorId !== undefined) {
      const moderatorKey = buildModeratorPromptKey(prompt.chatId, prompt.moderatorId);
      const storedKey = promptsByModerator.get(moderatorKey);
      if (storedKey === key) {
        promptsByModerator.delete(moderatorKey);
      }
    }

    pendingReplyPrompts.delete(key);
  }

  promptsByThread.delete(threadId);
};

const trackThreadState = (state: SupportThreadState): void => {
  threadsById.set(state.id, state);
  const key = buildMessageKey(state.moderatorChatId, state.moderatorMessageId);
  threadsByModeratorMessage.set(key, state.id);
};

const deleteThreadState = (threadId: string): void => {
  const state = threadsById.get(threadId);
  if (!state) {
    return;
  }

  threadsById.delete(threadId);
  const key = buildMessageKey(state.moderatorChatId, state.moderatorMessageId);
  threadsByModeratorMessage.delete(key);
  clearPromptsForThread(threadId);
};

export const restoreSupportThreads = async (): Promise<void> => {
  try {
    const { rows } = await pool.query<SupportThreadRow>(
      `
        SELECT
          id,
          user_chat_id,
          user_tg_id,
          user_message_id,
          moderator_chat_id,
          moderator_message_id,
          status
        FROM support_threads
        WHERE status = 'open'
      `,
    );

    for (const row of rows) {
      const state = mapThreadRowToState(row);
      if (!state) {
        logger.warn({ threadId: row.id }, 'Skipped restoring malformed support thread');
        continue;
      }

      trackThreadState(state);
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to restore support threads from database');
  }
};

const insertSupportThreadRecord = async (
  state: SupportThreadState,
): Promise<void> => {
  try {
    await pool.query<SupportThreadRow>(
      `
        INSERT INTO support_threads (
          id,
          user_chat_id,
          user_tg_id,
          user_message_id,
          moderator_chat_id,
          moderator_message_id,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        state.id,
        state.userChatId,
        state.userTelegramId ?? null,
        state.userMessageId,
        state.moderatorChatId,
        state.moderatorMessageId,
        state.status,
      ],
    );
  } catch (error) {
    logger.error(
      { err: error, threadId: state.id },
      'Failed to persist support thread record',
    );
  }
};

const markSupportThreadClosed = async (threadId: string): Promise<void> => {
  try {
    await pool.query<SupportThreadRow>(
      `
        UPDATE support_threads
        SET status = 'closed', closed_at = NOW()
        WHERE id = $1
      `,
      [threadId],
    );
  } catch (error) {
    logger.error(
      { err: error, threadId },
      'Failed to mark support thread as closed',
    );
  }
};

const buildSupportThreadKeyboard = (threadId: string) =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💬 Reply', `${REPLY_ACTION_PREFIX}:${threadId}`)],
    [Markup.button.callback('✅ Close', `${CLOSE_ACTION_PREFIX}:${threadId}`)],
  ]);

const formatSupportHeader = (ctx: BotContext, threadId: string): string => {
  const parts: string[] = [
    '🆘 Новое обращение в поддержку',
    `ID обращения: ${threadId}`,
  ];

  const userId = ctx.from?.id ?? ctx.chat?.id;
  if (userId) {
    parts.push(`Telegram ID: ${userId}`);
  }

  if (ctx.from?.username) {
    parts.push(`Username: @${ctx.from.username}`);
  }

  const fullName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter((value) => Boolean(value && value.trim().length > 0))
    .join(' ')
    .trim();

  if (fullName) {
    parts.push(`Имя: ${fullName}`);
  }

  return parts.join('\n');
};

const sendSupportHeader = async (
  ctx: BotContext,
  moderationChatId: number,
  threadId: string,
): Promise<number | undefined> => {
  const text = formatSupportHeader(ctx, threadId);

  try {
    const header = await ctx.telegram.sendMessage(moderationChatId, text);
    return header.message_id;
  } catch (error) {
    logger.error(
      { err: error, threadId, moderationChatId },
      'Failed to send support header message',
    );
    return undefined;
  }
};

const buildCopyOptions = (
  threadId: string,
  replyToMessageId?: number,
): ExtraCopyMessage => {
  const keyboard = buildSupportThreadKeyboard(threadId);

  const options: ExtraCopyMessage = {
    reply_markup: keyboard.reply_markup,
  } satisfies ExtraCopyMessage;

  if (replyToMessageId) {
    const mutable = options as Record<string, unknown>;
    mutable.reply_to_message_id = replyToMessageId;
    mutable.allow_sending_without_reply = true;
  }

  return options;
};

export interface SupportForwardResult {
  status: 'forwarded' | 'missing_channel' | 'skipped';
  threadId?: string;
  moderatorMessageId?: number;
}

const ensureSupportMessage = (ctx: BotContext): Message | undefined => {
  const message = ctx.message as Message | undefined;
  if (!message) {
    return undefined;
  }

  if (message.message_id === undefined || message.message_id === null) {
    return undefined;
  }

  return message;
};

export const forwardSupportMessage = async (
  ctx: BotContext,
): Promise<SupportForwardResult> => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    return { status: 'skipped' };
  }

  const message = ensureSupportMessage(ctx);
  if (!message) {
    return { status: 'skipped' };
  }

  const moderationChatId = await resolveModerationChannel();
  if (moderationChatId === null) {
    logger.warn(
      { chatId, messageId: message.message_id },
      'Support moderation channel is not configured',
    );
    return { status: 'missing_channel' };
  }

  const threadId = createThreadId();
  const headerMessageId = await sendSupportHeader(ctx, moderationChatId, threadId);

  let forwardedMessageId: number;
  try {
    const options = buildCopyOptions(threadId, headerMessageId);
    const forwarded = await ctx.telegram.copyMessage(
      moderationChatId,
      chatId,
      message.message_id,
      options,
    );
    forwardedMessageId = forwarded.message_id;
  } catch (error) {
    logger.error(
      { err: error, chatId, moderationChatId, messageId: message.message_id },
      'Failed to forward support message to moderation channel',
    );
    return { status: 'skipped' };
  }

  const state: SupportThreadState = {
    id: threadId,
    userChatId: chatId,
    userTelegramId: ctx.from?.id ?? ctx.chat?.id,
    userMessageId: message.message_id,
    moderatorChatId: moderationChatId,
    moderatorMessageId: forwardedMessageId,
    status: 'open',
  } satisfies SupportThreadState;

  trackThreadState(state);
  await insertSupportThreadRecord(state);

  return {
    status: 'forwarded',
    threadId,
    moderatorMessageId: forwardedMessageId,
  } satisfies SupportForwardResult;
};

const handleReplyAction = async (
  ctx: BotContext,
  threadId: string,
): Promise<void> => {
  const state = threadsById.get(threadId);
  if (!state || state.status !== 'open') {
    await ctx.answerCbQuery('Обращение недоступно. Возможно, оно уже закрыто.');
    return;
  }

  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    await ctx.answerCbQuery('Не удалось запросить ответ. Попробуйте ещё раз.');
    return;
  }

  const promptText =
    'Отправьте ответ пользователю сообщением. Это сообщение будет доставлено в личные сообщения.';
  const fallbackHint =
    '\n\nОтветьте на это сообщение, чтобы отправить ответ пользователю.';
  const moderatorId = ctx.from?.id;

  try {
    const forceReply: ForceReply = { force_reply: true, selective: true };
    const prompt = await ctx.reply(promptText, { reply_markup: forceReply });
    registerPrompt(threadId, prompt.chat.id, prompt.message_id, moderatorId);
    await ctx.answerCbQuery('Отправьте ответ пользователю сообщением.');
    return;
  } catch (error) {
    if (!isInlineKeyboardExpectedError(error)) {
      logger.error(
        { err: error, threadId },
        'Failed to prompt moderator for support reply',
      );
      await ctx.answerCbQuery('Не удалось запросить ответ. Попробуйте ещё раз.');
      return;
    }

    logger.warn(
      { err: error, threadId },
      'Force reply prompt failed, falling back to plain prompt',
    );
  }

  try {
    const prompt = await ctx.reply(`${promptText}${fallbackHint}`);
    registerPrompt(threadId, prompt.chat.id, prompt.message_id, moderatorId);
    await ctx.answerCbQuery('Отправьте ответ пользователю сообщением.');
  } catch (error) {
    logger.error(
      { err: error, threadId },
      'Failed to prompt moderator for support reply',
    );
    await ctx.answerCbQuery('Не удалось запросить ответ. Попробуйте ещё раз.');
  }
};

const notifyUserClosed = async (ctx: BotContext, state: SupportThreadState) => {
  try {
    await ctx.telegram.sendMessage(
      state.userChatId,
      '✅ Ваше обращение в поддержку было закрыто. Если у вас остались вопросы, отправьте новое сообщение.',
    );
  } catch (error) {
    logger.error(
      { err: error, threadId: state.id, userChatId: state.userChatId },
      'Failed to notify user about closed support thread',
    );
  }
};

const handleCloseAction = async (
  ctx: BotContext,
  threadId: string,
): Promise<void> => {
  const state = threadsById.get(threadId);
  if (!state) {
    await ctx.answerCbQuery('Обращение уже закрыто.');
    return;
  }

  if (state.status === 'closed') {
    await ctx.answerCbQuery('Обращение уже закрыто.');
    return;
  }

  state.status = 'closed';

  const keyboardCleared = await safeEditReplyMarkup(
    ctx.telegram,
    state.moderatorChatId,
    state.moderatorMessageId,
    undefined,
  );
  if (!keyboardCleared) {
    logger.debug(
      {
        threadId: state.id,
        chatId: state.moderatorChatId,
        messageId: state.moderatorMessageId,
      },
      'Failed to clear support thread inline keyboard on close',
    );
  }

  await markSupportThreadClosed(threadId);
  await notifyUserClosed(ctx, state);

  deleteThreadState(threadId);
  await ctx.answerCbQuery('Обращение закрыто.');
};

const copyModeratorReplyToUser = async (
  ctx: BotContext,
  state: SupportThreadState,
): Promise<boolean> => {
  const message = ctx.message as Message | undefined;
  if (!message) {
    return false;
  }

  try {
    await ctx.telegram.copyMessage(
      state.userChatId,
      ctx.chat?.id ?? state.moderatorChatId,
      message.message_id,
    );
    return true;
  } catch (error) {
    logger.error(
      {
        err: error,
        threadId: state.id,
        userChatId: state.userChatId,
        moderatorChatId: state.moderatorChatId,
        messageId: message.message_id,
      },
      'Failed to deliver moderator reply to support user',
    );
    return false;
  }
};

const acknowledgeModeratorReply = async (
  ctx: BotContext,
  messageId: number,
  text: string,
): Promise<void> => {
  try {
    await ctx.reply(text, {
      reply_parameters: {
        message_id: messageId,
        allow_sending_without_reply: true,
      },
    });
  } catch (error) {
    logger.debug(
      { err: error, chatId: ctx.chat?.id, messageId },
      'Failed to acknowledge moderator reply',
    );
  }
};

const handleModeratorReplyMessage = async (
  ctx: BotContext,
): Promise<boolean> => {
  const message = ctx.message as Message | undefined;
  const chatId = ctx.chat?.id;

  if (!message || chatId === undefined) {
    return false;
  }

  const replyTo = (message as Partial<{ reply_to_message: Message }>)
    ?.reply_to_message;
  const moderatorId = ctx.from?.id;

  let promptKey =
    replyTo !== undefined
      ? buildMessageKey(chatId, replyTo.message_id)
      : undefined;
  let prompt = promptKey ? pendingReplyPrompts.get(promptKey) : undefined;

  if (!prompt && moderatorId !== undefined) {
    const moderatorKey = buildModeratorPromptKey(chatId, moderatorId);
    const storedKey = promptsByModerator.get(moderatorKey);
    if (storedKey) {
      const storedPrompt = pendingReplyPrompts.get(storedKey);
      if (storedPrompt) {
        prompt = storedPrompt;
        promptKey = storedKey;
      } else {
        promptsByModerator.delete(moderatorKey);
      }
    }
  }

  if (!prompt) {
    if (!promptKey) {
      return false;
    }

    const threadId = threadsByModeratorMessage.get(promptKey);
    if (!threadId) {
      return false;
    }

    const state = threadsById.get(threadId);
    if (!state) {
      threadsByModeratorMessage.delete(promptKey);
      await acknowledgeModeratorReply(
        ctx,
        message.message_id,
        'Обращение уже закрыто.',
      );
      return true;
    }

    if (state.status !== 'open') {
      threadsByModeratorMessage.delete(promptKey);
      await acknowledgeModeratorReply(
        ctx,
        message.message_id,
        'Обращение уже закрыто.',
      );
      return true;
    }

    const delivered = await copyModeratorReplyToUser(ctx, state);
    const response = delivered
      ? 'Ответ доставлен пользователю.'
      : 'Не удалось доставить ответ пользователю.';

    await acknowledgeModeratorReply(ctx, message.message_id, response);
    return true;
  }

  if (prompt.moderatorId !== undefined && moderatorId !== prompt.moderatorId) {
    return false;
  }

  const state = threadsById.get(prompt.threadId);
  if (!state) {
    if (promptKey) {
      clearPrompt(promptKey);
    }
    await acknowledgeModeratorReply(
      ctx,
      message.message_id,
      'Обращение уже закрыто.',
    );
    return true;
  }

  if (state.status !== 'open') {
    if (promptKey) {
      clearPrompt(promptKey);
    }
    await acknowledgeModeratorReply(
      ctx,
      message.message_id,
      'Обращение уже закрыто.',
    );
    return true;
  }

  const delivered = await copyModeratorReplyToUser(ctx, state);
  if (promptKey) {
    clearPrompt(promptKey);
  }

  const response = delivered
    ? 'Ответ доставлен пользователю.'
    : 'Не удалось доставить ответ пользователю.';

  await acknowledgeModeratorReply(ctx, message.message_id, response);
  return true;
};

export const registerSupportModerationBridge = (
  bot: Telegraf<BotContext>,
): void => {
  bot.action(REPLY_ACTION_PATTERN, async (ctx: BotContext) => {
    const match = (ctx as BotContext & { match?: RegExpMatchArray }).match;
    const threadId = match?.[1];
    if (!threadId) {
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    await handleReplyAction(ctx, threadId);
  });

  bot.action(CLOSE_ACTION_PATTERN, async (ctx: BotContext) => {
    const match = (ctx as BotContext & { match?: RegExpMatchArray }).match;
    const threadId = match?.[1];
    if (!threadId) {
      await ctx.answerCbQuery('Некорректное действие.');
      return;
    }

    await handleCloseAction(ctx, threadId);
  });

  bot.on('message', async (ctx: BotContext, next?: () => Promise<void>) => {
    const handled = await handleModeratorReplyMessage(ctx);
    if (!handled && next) {
      await next();
    }
  });
};

const resetSupportState = (): void => {
  threadsById.clear();
  threadsByModeratorMessage.clear();
  pendingReplyPrompts.clear();
  promptsByThread.clear();
  promptsByModerator.clear();
  resolveModerationChannel = defaultResolveModerationChannel;
};

export const __testing__ = {
  threadsById,
  pendingReplyPrompts,
  promptsByThread,
  handleReplyAction,
  handleCloseAction,
  handleModeratorReplyMessage,
  registerPrompt,
  deleteThreadState,
  resetSupportState,
  restoreSupportThreads,
  setModerationChannelResolver: (resolver: ModerationChannelResolver | null) => {
    resolveModerationChannel = resolver ?? defaultResolveModerationChannel;
  },
};
