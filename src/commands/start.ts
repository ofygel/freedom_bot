import { Telegraf, Markup, Context } from 'telegraf';

export default function startCommand(bot: Telegraf) {
  bot.start(async (ctx) => {
    await ctx.reply(
      'Добро пожаловать 👋\nСервис доставок в Алматы. Выберите роль.',
      Markup.keyboard([
        ['Заказать доставку'],
        ['Стать исполнителем']
      ]).oneTime().resize()
    );
  });

  const requestContact = async (ctx: Context) => {
    await ctx.reply(
      'Нужно подтвердить номер телефона.',
      Markup.keyboard([
        [Markup.button.contactRequest('Поделиться номером')]
      ]).oneTime().resize()
    );
  };

  bot.hears('Заказать доставку', requestContact);
  bot.hears('Стать исполнителем', requestContact);

  bot.on('contact', async (ctx) => {
    await ctx.reply('Спасибо! Контакт получен.');
  });
}
