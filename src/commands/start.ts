import { Telegraf, Context, Markup } from 'telegraf';
import { upsertUser } from '../services/users';
import { startProfileWizard } from './profile';

interface StartState {
  step: 'role' | 'phone' | 'consent';
  data: { role?: 'client' | 'courier'; phone?: string; city?: string };
  msgId?: number;
}

const states = new Map<number, StartState>();

export default function registerStart(bot: Telegraf<Context>) {
  bot.start(async (ctx) => {
    const uid = ctx.from!.id;
    const msg = await ctx.reply(
      'Добро пожаловать! Выберите действие:',
      Markup.keyboard([['Заказать доставку'], ['Стать исполнителем']]).resize()
    );
    states.set(uid, { step: 'role', data: {}, msgId: msg.message_id });
  });

  bot.hears('Заказать доставку', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    state.data.role = 'client';
    state.step = 'phone';
    const msg = await ctx.reply(
      'Пожалуйста, отправьте ваш номер телефона.',
      Markup.keyboard([[Markup.button.contactRequest('Отправить телефон')]]).resize()
    );
    state.msgId = msg.message_id;
  });

  bot.hears('Стать исполнителем', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'role') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    state.data.role = 'courier';
    state.step = 'phone';
    const msg = await ctx.reply(
      'Пожалуйста, отправьте ваш номер телефона.',
      Markup.keyboard([[Markup.button.contactRequest('Отправить телефон')]]).resize()
    );
    state.msgId = msg.message_id;
  });

  bot.on('contact', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state || state.step !== 'phone') return;
    if (state.msgId)
      await ctx.telegram.deleteMessage(ctx.chat!.id, state.msgId).catch(() => {});
    const phone = ctx.message.contact.phone_number;
    state.data.phone = phone;
    const role = state.data.role;
    const city = 'Алматы';
    state.data.city = city;
    upsertUser({ id: uid, phone, role, city });
    if (role === 'client') {
      state.step = 'consent';
      const msg = await ctx.reply(
        'Согласны ли вы с условиями сервиса?',
        Markup.keyboard([['Да'], ['Нет']]).resize()
      );
      state.msgId = msg.message_id;
    } else if (role === 'courier') {
      states.delete(uid);
      await startProfileWizard(ctx);
    } else {
      states.delete(uid);
    }
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
