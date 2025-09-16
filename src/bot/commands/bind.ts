import { Telegraf } from 'telegraf';
import type { MessageEntity } from 'telegraf/types';

import { saveChannelBinding, type ChannelType } from '../../channels';
import { logger } from '../../config';
import type { BotContext } from '../types';

type BindSource = 'private' | 'channel';

const CHANNEL_LABELS: Record<ChannelType, string> = {
  moderation: 'канал модерации',
  drivers: 'канал курьеров',
};

const AVAILABLE_TYPES_HINT = 'moderation или drivers';

const isCommandEntity = (entity?: MessageEntity): entity is MessageEntity =>
  Boolean(entity && entity.type === 'bot_command' && entity.offset === 0);

const extractCommandArgs = (text: string, entity: MessageEntity): string[] => {
  const payload = text.slice(entity.offset + entity.length).trim();
  if (!payload) {
    return [];
  }

  return payload.split(/\s+/u).filter(Boolean);
};

const parseChannelType = (value: string | undefined): ChannelType | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'moderation' || normalized === 'moderator') {
    return 'moderation';
  }

  if (normalized === 'drivers' || normalized === 'driver') {
    return 'drivers';
  }

  return undefined;
};

const parseChatIdentifier = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!/^[-]?\d+$/u.test(trimmed)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
};

interface TargetChannel {
  id: number;
  title?: string;
  username?: string;
}

type ForwardingSource = {
  forward_from_chat?: { id: number; title?: string; username?: string; type?: string };
  reply_to_message?: ForwardingSource;
  sender_chat?: { id: number; title?: string; username?: string; type?: string };
};

const extractForwardedChannel = (
  message: BotContext['message'] | undefined,
): TargetChannel | undefined => {
  if (!message) {
    return undefined;
  }

  const source = message as ForwardingSource;
  const forwarded =
    source.forward_from_chat ??
    source.reply_to_message?.forward_from_chat ??
    source.sender_chat;

  if (!forwarded || forwarded.type !== 'channel') {
    return undefined;
  }

  return {
    id: forwarded.id,
    title: forwarded.title ?? undefined,
    username: forwarded.username ?? undefined,
  } satisfies TargetChannel;
};

interface MessageLike {
  text?: string;
  caption?: string;
  entities?: MessageEntity[];
  caption_entities?: MessageEntity[];
}

const toMessageLike = (value: unknown): MessageLike | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return value as MessageLike;
};

const resolveTargetChannel = (
  ctx: BotContext,
  source: BindSource,
  explicitId?: string,
): TargetChannel | undefined => {
  if (source === 'channel' && ctx.channelPost) {
    const chat = ctx.channelPost.chat;
    if (chat.type !== 'channel') {
      return undefined;
    }

    return {
      id: chat.id,
      title: chat.title ?? undefined,
      username: chat.username ?? undefined,
    } satisfies TargetChannel;
  }

  const forwarded = extractForwardedChannel(ctx.message);
  if (forwarded) {
    return forwarded;
  }

  const parsed = parseChatIdentifier(explicitId);
  if (parsed !== undefined) {
    return { id: parsed };
  }

  return undefined;
};

const formatChannelReference = (target: TargetChannel): string => {
  if (target.username) {
    return `@${target.username}`;
  }

  if (target.title) {
    return `${target.title} (ID ${target.id})`;
  }

  return `ID ${target.id}`;
};

const sendUsageHint = async (ctx: BotContext): Promise<void> => {
  await ctx.reply(
    [
      'Не удалось определить канал. ',
      'Отправьте команду внутри нужного канала или в личных сообщениях с ботом, ',
      'переслав сообщение из канала и указав тип: ',
      AVAILABLE_TYPES_HINT,
      '.',
    ].join(''),
  );
};

const processBinding = async (
  ctx: BotContext,
  text: string,
  commandEntity: MessageEntity,
  source: BindSource,
): Promise<void> => {
  const [typeToken, explicitId] = extractCommandArgs(text, commandEntity);

  if (!typeToken) {
    await ctx.reply(`Укажите тип канала (${AVAILABLE_TYPES_HINT}).`);
    return;
  }

  const channelType = parseChannelType(typeToken);
  if (!channelType) {
    await ctx.reply(
      `Неизвестный тип канала. Доступные значения: ${AVAILABLE_TYPES_HINT}.`,
    );
    return;
  }

  const targetChannel = resolveTargetChannel(ctx, source, explicitId);
  if (!targetChannel) {
    await sendUsageHint(ctx);
    return;
  }

  try {
    await saveChannelBinding({ type: channelType, chatId: targetChannel.id });
  } catch (error) {
    logger.error(
      { err: error, type: channelType, channelId: targetChannel.id },
      'Failed to persist channel binding',
    );
    await ctx.reply('Не удалось сохранить привязку канала. Попробуйте позже.');
    return;
  }

  const label = CHANNEL_LABELS[channelType];
  await ctx.reply(`Готово! ${label} привязан к ${formatChannelReference(targetChannel)}.`);
};

export const registerBindCommand = (bot: Telegraf<BotContext>): void => {
  bot.command('bind', async (ctx) => {
    const message = toMessageLike(ctx.message);
    if (!message) {
      return;
    }

    const text = message.text ?? message.caption;
    if (!text) {
      return;
    }

    const entity =
      message.entities?.find(isCommandEntity) ??
      message.caption_entities?.find(isCommandEntity);
    if (!entity) {
      return;
    }

    await processBinding(ctx, text, entity, 'private');
  });

  bot.on('channel_post', async (ctx, next) => {
    const post = toMessageLike(ctx.channelPost);
    if (!post) {
      await next();
      return;
    }

    const text = post.text ?? post.caption;
    if (!text) {
      await next();
      return;
    }

    const entity =
      post.entities?.find(isCommandEntity) ??
      post.caption_entities?.find(isCommandEntity);
    if (!entity) {
      await next();
      return;
    }

    const command = text
      .slice(entity.offset, entity.offset + entity.length)
      .split('@')[0];
    if (command !== '/bind') {
      await next();
      return;
    }

    await processBinding(ctx, text, entity, 'channel');
  });
};

