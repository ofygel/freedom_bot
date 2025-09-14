import { Telegraf, Context, Markup } from 'telegraf';
import { upsertUser } from '../services/users.js';
import { startProfileWizard } from './profile.js';

interface StartState {
  step: 'phone' | 'role' | 'city' | 'consent';
  data: { phone?: string; city?: string };
}

const states = new Map<number, StartState>();

export default function registerStart(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const uid = ctx.from!.id;
    states.set(uid, { step: 'phone', data: {} });
    await ctx.reply(
      'Добро пожаловать! Пожалуйста, отправьте ваш номер телефона.',
      Markup.keyboard([[Markup.button.contactRequest('Отправить телефон')]]).resize()
    );
  });

  bot.on('contact', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'phone') return;
    const phone = ctx.message.contact.phone_number;
    state.data.phone = phone;
    state.step = 'role';
    upsertUser({ id: uid, phone });
    await ctx.reply(
      'Вы клиент или курьер?',
      Markup.keyboard([['Клиент'], ['Курьер']]).resize()
    );
  });

  bot.hears('Клиент', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    state.step = 'city';
    upsertUser({ id: uid, phone: state.data.phone, role: 'client' });
    await ctx.reply('Укажите ваш город', Markup.keyboard([['Алматы']]).resize());
  });

  bot.hears('Курьер', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    upsertUser({ id: uid, phone: state.data.phone, role: 'courier' });
    states.delete(uid);
    await startProfileWizard(ctx);
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
    if (state.step === 'city') {
      state.data.city = text;
      state.step = 'consent';
      upsertUser({
        id: uid,
        phone: state.data.phone,
        role: 'client',
        city: text,
      });
      await ctx.reply(
        'Согласны ли вы с условиями сервиса?',
        Markup.keyboard([['Да'], ['Нет']]).resize()
      );
    } else if (state.step === 'consent') {
      if (text.toLowerCase() === 'да') {
        upsertUser({
          id: uid,
          phone: state.data.phone,
          role: 'client',
          city: state.data.city,
          consent: true,
        });
        states.delete(uid);
        await ctx.reply(
          'Главное меню',
          Markup.keyboard([
            ['Создать заказ'],
            ['Мои заказы'],
            ['Поддержка'],
          ]).resize()
        );
      } else {
        await ctx.reply('Для продолжения необходимо согласие.');
      }
    }
  });
}

