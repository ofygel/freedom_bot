import { Telegraf, Markup, Context } from 'telegraf';
import { upsertUser, getUser } from '../services/users.js';

export default function startCommand(bot: Telegraf) {
  const pendingRoles = new Map<number, 'client' | 'courier'>();
  const pendingAgreement = new Map<number, 'client' | 'courier'>();

  const replyAndDelete = async (
    ctx: Context,
    text: string,
    extra?: any,
    ms = 60000
  ) => {
    const msg = await ctx.reply(text, extra);
    setTimeout(() => ctx.deleteMessage(msg.message_id).catch(() => {}), ms);
  };

  const sendError = (ctx: Context, text: string) => replyAndDelete(ctx, text, undefined, 10000);

  bot.start(async (ctx) => {
    await replyAndDelete(
      ctx,
      'Добро пожаловать 👋\nСервис доставок в Алматы. Выберите роль.',
      Markup.keyboard([
        ['Заказать доставку'],
        ['Стать исполнителем']
      ]).oneTime().resize()
    );
  });

  const requestContact = async (ctx: Context, role: 'client' | 'courier') => {
    pendingRoles.set(ctx.from!.id, role);
    await replyAndDelete(
      ctx,
      'Нужно подтвердить номер телефона.',
      Markup.keyboard([[Markup.button.contactRequest('Поделиться номером')]])
        .oneTime()
        .resize()
    );
  };

  bot.hears('Заказать доставку', (ctx) => requestContact(ctx, 'client'));
  bot.hears('Стать исполнителем', (ctx) => requestContact(ctx, 'courier'));

  bot.on('contact', async (ctx) => {
    const uid = ctx.from!.id;
    const role = pendingRoles.get(uid);
    if (!role) {
      await sendError(ctx, 'Сначала выберите роль через /start.');
      return;
    }
    const phone = ctx.message.contact?.phone_number;
    if (!phone) {
      await sendError(ctx, 'Не удалось получить номер. Нажмите кнопку «Поделиться номером».');
      return;
    }
    upsertUser({ id: uid, phone, role, city: 'Алматы', agreed: false });
    pendingRoles.delete(uid);
    pendingAgreement.set(uid, role);
    await replyAndDelete(
      ctx,
      'Город: Алматы. Согласны с правилами сервиса?',
      Markup.keyboard([['Согласен']]).oneTime().resize()
    );
  });

  bot.hears('Согласен', async (ctx) => {
    const uid = ctx.from!.id;
    const role = pendingAgreement.get(uid);
    if (!role) {
      await sendError(ctx, 'Сначала поделитесь контактом через /start.');
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
  bot.hears('Поддержка', (ctx) => ctx.reply('Поддержка в разработке.'));
  bot.hears('Онлайн/Оффлайн', (ctx) => ctx.reply('Режим курьера переключен.'));
  bot.hears('Лента заказов', (ctx) => ctx.reply('Лента заказов в разработке.'));
  bot.hears('Баланс/Выплаты', (ctx) => ctx.reply('Информация о балансе в разработке.'));
  bot.hears('Профиль', (ctx) => ctx.reply('Профиль в разработке.'));
}

