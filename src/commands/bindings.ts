import type { Telegraf, Context } from 'telegraf';
import { getSettings, saveSettings, type Settings } from '../services/settings';

type BindingKey = keyof Pick<Settings,'drivers_channel_id'|'moderators_channel_id'>;

export function registerBindingCommands(bot: Telegraf<Context>) {
  // support commands from channels (channel_post)
  bot.on('channel_post', async (ctx) => {
    const text = (ctx.channelPost as any)?.text?.trim();
    if (!text) return;

    if (text === '/bind_drivers_channel') {
      await bindChannel(ctx, 'drivers_channel_id');
    } else if (text === '/bind_moderators_channel') {
      await bindChannel(ctx, 'moderators_channel_id');
    }
  });

  // also allow from chats by replying with channel id number
  bot.command('bind_drivers_channel', async (ctx) => bindChannel(ctx, 'drivers_channel_id'));
  bot.command('bind_moderators_channel', async (ctx) => bindChannel(ctx, 'moderators_channel_id'));
}

async function bindChannel(ctx: Context, key: BindingKey) {
  // if command came from a channel
  if (ctx.chat?.type === 'channel') {
    const from = ctx.from;
    if (!from) return;
    const member = await ctx.telegram.getChatMember(ctx.chat.id, from.id);
    if (!['creator','administrator'].includes(member.status)) {
      await ctx.reply('Нужно быть администратором канала.');
      return;
    }
    const s = getSettings();
    (s as any)[key] = String(ctx.chat.id);
    saveSettings(s);
    await ctx.reply(`Ок. Привязал канал: ${ctx.chat.title} (${ctx.chat.id})`);
    return;
  }

  // if command came from a private/group chat, expect an argument: numeric channel id
  const arg = (ctx.message as any)?.text?.split(' ')[1];
  if (!arg || !/^-?\d+$/.test(arg)) {
    await ctx.reply('Отправьте команду из канала (как администратор) ИЛИ укажите numeric ID канала аргументом.');
    return;
  }
  const s = getSettings();
  (s as any)[key] = arg;
  saveSettings(s);
  await ctx.reply(`Сохранил ${key} = ${arg}`);
}
