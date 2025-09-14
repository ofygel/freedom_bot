import { Telegraf, Markup, Context } from 'telegraf';
import { upsertUser, getUser } from '../services/users.js';

export default function startCommand(bot: Telegraf) {
  const pendingRoles = new Map<number, 'client' | 'courier'>();
  const pendingAgreement = new Map<number, 'client' | 'courier'>();
  const pendingCity = new Map<number, true>();

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
    upsertUser({ id: uid, phone, role, city: 'Алматы', agreed: false });
    pendingRoles.delete(uid);
    if (role === 'client') {
      pendingCity.set(uid, true);
      await ctx.reply('Введите ваш город (по умолчанию Алматы).');
    } else {
      pendingAgreement.set(uid, role);
      await ctx.reply(
        'Согласны с правилами сервиса?',
        Markup.keyboard([
          ['Согласен']
        ]).oneTime().resize()
      );
    }
  });

  bot.on('text', async (ctx, next: () => Promise<void>) => {
    const uid = ctx.from!.id;
    if (pendingCity.has(uid)) {
      const city = ctx.message.text?.trim() || 'Алматы';
      const user = getUser(uid);
      if (user) {
        upsertUser({ ...user, city });
      }
      pendingCity.delete(uid);
      pendingAgreement.set(uid, 'client');
      await ctx.reply(
        'Согласны с правилами сервиса?',
        Markup.keyboard([
          ['Согласен']
        ]).oneTime().resize()
      );
      return;
    }
    return next();
  });

  bot.hears('Согласен', async (ctx) => {
    const uid = ctx.from!.id;
    const role = pendingAgreement.get(uid);
    if (!role) {
      await ctx.reply('Сначала поделитесь контактом через /start');
      return;
    }
    const user = getUser(uid);
    if (user) {
      upsertUser({ ...user, agreed: true });
    }
    pendingAgreement.delete(uid);
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
          ['Онлайн/Оффлайн', 'Лента заказов'],
          ['Мои заказы', 'Баланс/Выплаты'],
          ['Профиль', 'Поддержка']
        ]).resize()
      );
    }
  });

  bot.hears('Создать заказ', (ctx) => ctx.reply('Создание заказа в разработке.'));
  bot.hears('Мои заказы', (ctx) => ctx.reply('Здесь будут ваши заказы.'));
  bot.hears('Профиль', (ctx) => ctx.reply('Профиль в разработке.'));
  bot.hears('Поддержка', (ctx) => ctx.reply('Поддержка в разработке.'));
  bot.hears('Онлайн/Оффлайн', (ctx) => ctx.reply('Режим курьера переключен.'));
  bot.hears('Лента заказов', (ctx) => ctx.reply('Лента заказов в разработке.'));
  bot.hears('Баланс/Выплаты', (ctx) => ctx.reply('Информация о балансе в разработке.'));
}
