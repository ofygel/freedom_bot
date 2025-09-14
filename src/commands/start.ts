import type { Telegraf, Context } from 'telegraf';

export default function registerStart(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const name = ctx.from?.first_name ?? 'друг';
    await ctx.reply(
`Привет, ${name}! �
Я помогу оформить заказ такси или доставки в Алматы.

Команды:
• /order <ссылка_2ГИС_откуда> <ссылка_2ГИС_куда>
• /bind_drivers_channel — отправить команду из канала (как админ) для привязки канала исполнителей
• /bind_moderators_channel — отправить команду из канала (как админ) для привязки канала модерации
• /ping — проверка связи`
    );
  });
}
