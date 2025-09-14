import { Telegraf, Context, Markup } from 'telegraf';
import { upsertUser } from '../services/users.js';
import { startProfileWizard } from './profile.js';

interface StartState {
  step: 'phone' | 'role' | 'consent';
  data: { phone?: string; city?: string };
  msgId?: number;
}

const states = new Map<number, StartState>();

export default function registerStart(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const uid = ctx.from!.id;
    const msg = await ctx.reply(
      'Добро пожаловать! Пожалуйста, отправьте ваш номер телефона.',
      Markup.keyboard([[Markup.button.contactRequest('Отправить телефон')]]).resize()
    );
    states.set(uid, { step: 'phone', data: {}, msgId: msg.message_id });
  });

  bot.on('contact', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'phone') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    const phone = ctx.message.contact.phone_number;
    state.data.phone = phone;
    state.step = 'role';
    upsertUser({ id: uid, phone, city: 'Алматы' });
    const msg = await ctx.reply(
      'Вы клиент или курьер?',
      Markup.keyboard([['Клиент'], ['Курьер']]).resize()
    );
    state.msgId = msg.message_id;
  });

  bot.hears('Клиент', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    const city = 'Алматы';
    state.data.city = city;
    state.step = 'consent';
    upsertUser({ id: uid, phone: state.data.phone, role: 'client', city });
    const msg = await ctx.reply(
      'Согласны ли вы с условиями сервиса?',
      Markup.keyboard([['Да'], ['Нет']]).resize()
    );
    state.msgId = msg.message_id;
  });

  bot.hears('Курьер', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    upsertUser({ id: uid, phone: state.data.phone, role: 'courier', city: 'Алматы' });
    states.delete(uid);
    await startProfileWizard(ctx);
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
    if (state.step === 'consent') {
      if (state.msgId)
        await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
      if (text.toLowerCase() === 'да') {
        upsertUser({
          id: uid,
          phone: state.data.phone,
          role: 'client',
          city: state.data.city || 'Алматы',
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
        const msg = await ctx.reply('Для продолжения необходимо согласие.');
        state.msgId = msg.message_id;
      }
    }
  });
}
