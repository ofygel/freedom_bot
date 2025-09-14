import { Telegraf, Markup, Context } from 'telegraf';
import { upsertUser } from '../services/users.js';

export default function startCommand(bot: Telegraf) {
  const pendingRoles = new Map<number, 'client' | 'courier'>();

  bot.start(async (ctx) => {
    await ctx.reply(
      'Добро пожаловать 👋\nСервис доставок в Алматы. Выберите роль.',
      Markup.keyboard([
        ['Заказать доставку'],
        ['Стать исполнителем']
      ]).oneTime().resize()
    );
  });

  const requestContact = async (ctx: Context, role: 'client' | 'courier') => {
    pendingRoles.set(ctx.from!.id, role);
    await ctx.reply(
      'Нужно подтвердить номер телефона.',
      Markup.keyboard([
        [Markup.button.contactRequest('Поделиться номером')]
      ]).oneTime().resize()
    );
  };

  bot.hears('Заказать доставку', (ctx) => requestContact(ctx, 'client'));
  bot.hears('Стать исполнителем', (ctx) => requestContact(ctx, 'courier'));

  bot.on('contact', async (ctx) => {
    const uid = ctx.from!.id;
    const role = pendingRoles.get(uid);
    if (!role) {
      await ctx.reply('Сначала выберите роль.');
      return;
    }
    const phone = ctx.message.contact?.phone_number;
    if (!phone) {
      await ctx.reply('Не удалось получить номер. Нажмите кнопку «Поделиться номером».');
      return;
    }
    upsertUser({ id: uid, phone, role });
    pendingRoles.delete(uid);
    if (role === 'client') {
      await ctx.reply(
        'Спасибо! Контакт получен.',
        Markup.keyboard([
          ['Создать заказ'],
          ['Мои заказы', 'Поддержка']
        ]).resize()
      );
    } else {
      await ctx.reply(
        'Спасибо! Контакт получен.',
        Markup.keyboard([
          ['Профиль'],
          ['Поддержка']
        ]).resize()
      );
    }
  });

  bot.hears('Мои заказы', (ctx) => ctx.reply('Здесь будут ваши заказы.'));
  bot.hears('Профиль', (ctx) => ctx.reply('Профиль в разработке.'));
  bot.hears('Поддержка', (ctx) => ctx.reply('Поддержка в разработке.'));
}
