import { Telegraf, Context } from 'telegraf';
import { updateSetting, getSettings } from '../services/settings.js';

type BindingKey = 'verify_channel_id' | 'drivers_channel_id';

export function handleBindingCommands(bot: Telegraf) {
  bot.on('channel_post', async (ctx) => {
    const text = (ctx.channelPost as any)?.text?.trim();
    if (!text) return;
    if (text === '/bind_verify_channel') {
      await bindChannel(ctx, 'verify_channel_id');
    } else if (text === '/bind_drivers_channel') {
      await bindChannel(ctx, 'drivers_channel_id');
    }
  });
}

async function bindChannel(ctx: Context, key: BindingKey) {
  if (ctx.chat?.type !== 'channel') {
    await ctx.reply('Команда работает только в канале');
    return;
  }
  const from = ctx.from;
  if (!from) return;
  const member = await ctx.telegram.getChatMember(ctx.chat.id, from.id);
  if (!['administrator', 'creator'].includes(member.status)) {
    await ctx.reply('Нужны права администратора канала');
    return;
  }
  const botMember = await ctx.telegram.getChatMember(ctx.chat.id, ctx.botInfo.id);
  if (
    !['administrator', 'creator'].includes(botMember.status) ||
    (botMember.status === 'administrator' && botMember.can_post_messages === false)
  ) {
    await ctx.reply('У бота нет прав на публикацию сообщений');
    return;
  }
  updateSetting(key, ctx.chat.id);
  const title = ctx.chat.title ?? '—';
  const label = key === 'verify_channel_id' ? 'verify-канал' : 'drivers-канал';
  await ctx.reply(`✅ Привязан ${label}: ${title} (id: ${ctx.chat.id})`);
}

export function pingBindingsCommand(bot: Telegraf) {
  bot.command('ping_bindings', async (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const settings = getSettings();
    await ctx.reply(
      `verify_channel_id: ${settings.verify_channel_id ?? 'не привязан'}\n` +
        `drivers_channel_id: ${settings.drivers_channel_id ?? 'не привязан'}`
    );
  });
}
