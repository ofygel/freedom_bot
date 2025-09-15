import type { Telegraf, Context } from 'telegraf';
import { saveBinding, type BindingKey } from '../services/settings';

export function registerBindingCommands(bot: Telegraf<Context>) {
  bot.on('channel_post', async (ctx) => {
    const text = (ctx.channelPost as any)?.text?.trim();
    if (!text) return;
    if (text === '/bind_couriers_channel') return bindChannel(ctx, 'couriers_channel_id');
    if (text === '/bind_moderators_channel') return bindChannel(ctx, 'moderators_channel_id');
    if (text === '/bind_verify_channel') return bindChannel(ctx, 'verify_channel_id');
  });
  bot.command('bind_couriers_channel', async (ctx) => bindChannel(ctx, 'couriers_channel_id'));
  bot.command('bind_moderators_channel', async (ctx) => bindChannel(ctx, 'moderators_channel_id'));
  bot.command('bind_verify_channel', async (ctx) => bindChannel(ctx, 'verify_channel_id'));
}

async function bindChannel(ctx: Context, key: BindingKey) {
  if (ctx.chat?.type === 'channel') {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from!.id);
    if (!['creator','administrator'].includes(member.status)) {
      await ctx.reply('Нужно быть администратором канала.');
      return;
    }
    saveBinding(key, String(ctx.chat.id));
    const msg =
      key === 'verify_channel_id'
        ? `✅ Привязан verify-канал: ${ctx.chat.title} (id: ${ctx.chat.id})`
        : `Привязал канал: ${ctx.chat.title} (${ctx.chat.id})`;
    await ctx.reply(msg);
    return;
  }
  const arg = (ctx.message as any)?.text?.split(' ')[1];
  if (!arg || !/^-?\d+$/.test(arg)) {
    await ctx.reply('Отправьте команду из канала (как админ) ИЛИ укажите числовой ID канала аргументом.');
    return;
  }
  saveBinding(key, arg);
  await ctx.reply(`Сохранил ${key} = ${arg}`);
}
