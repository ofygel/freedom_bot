import type { Telegraf, Context } from 'telegraf';

export default function registerStart(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const name = ctx.from?.first_name ?? 'друг';
    await ctx.reply(
`Привет, ${name}! �
Я помогу оформить заказ такси или доставки в Алматы.

Команды:
• /order <ссылка_2GIS_откуда> <ссылка_2GIS_куда> — быстрый заказ по ссылкам 2ГИС
• /bind_drivers_channel — выполнить в канале для привязки канала исполнителей
• /bind_moderators_channel — выполнить в канале для привязки канала модераторов
• /ping — проверка связи`
    );
  });
}
