import { Telegraf, Markup } from 'telegraf';
import { pointInPolygon } from '../utils/geo.js';
import { calcPrice } from '../utils/pricing.js';
import { getSettings } from '../services/settings.js';
import { getUser } from '../services/users.js';
import { createOrder } from '../services/orders.js';

interface WizardState {
  step: 'from' | 'to' | 'size' | 'confirm';
  data: any;
}

const states = new Map<number, WizardState>();

export default function orderCommands(bot: Telegraf) {
  bot.hears('Создать заказ', (ctx) => {
    const settings = getSettings();
    const start = settings.order_hours_start ?? 8;
    const end = settings.order_hours_end ?? 23;
    const hour = (new Date().getUTCHours() + 6) % 24;
    if (hour < start || hour >= end) {
      return ctx.reply(`Заказы принимаются с ${start.toString().padStart(2,'0')}:00 до ${end.toString().padStart(2,'0')}:00 по времени Алматы.`);
    }
    const user = getUser(ctx.from!.id);
    if (!user || !user.agreed) return ctx.reply('Сначала поделитесь контактом и согласитесь с правилами через /start');
    states.set(ctx.from!.id, { step: 'from', data: {} });
    ctx.reply(
      'Отправьте геолокацию точки отправления',
      Markup.keyboard([[Markup.button.locationRequest('Отправить гео')], ['Отмена']]).resize()
    );
  });

  bot.hears('Отмена', (ctx) => {
    states.delete(ctx.from!.id);
    ctx.reply('Заказ отменён', Markup.removeKeyboard());
  });

  bot.on('location', (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const { latitude: lat, longitude: lon } = ctx.message.location;
    const settings = getSettings();
    if (settings.city_polygon && !pointInPolygon({ lat, lon }, settings.city_polygon)) {
      return ctx.reply('Адрес вне зоны обслуживания, отправьте другой.');
    }
    if (state.step === 'from') {
      state.data.from = { lat, lon };
      state.step = 'to';
      return ctx.reply(
        'Отправьте геолокацию точки назначения',
        Markup.keyboard([[Markup.button.locationRequest('Отправить гео')], ['Отмена']]).resize()
      );
    }
    if (state.step === 'to') {
      state.data.to = { lat, lon };
      state.step = 'size';
      return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
    }
  });

  bot.on('text', (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    const text = ctx.message.text.trim();
    if (!state) return;
    switch (state.step) {
      case 'size': {
        if (!['S', 'M', 'L'].includes(text)) return ctx.reply('Выберите S, M или L.');
        state.data.size = text;
        const settings = getSettings();
        const { distance, price, night } = calcPrice(state.data.from, state.data.to, 0, state.data.size, settings);
        state.data.price = price;
        let summary = `Дистанция: ${distance.toFixed(1)} км\nСтоимость: ${price} ₸`;
        if (night) summary += '\nНочной коэффициент применён';
        state.step = 'confirm';
        return ctx.reply(summary, Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
      }
      case 'confirm': {
        if (text !== 'Подтвердить заказ') return ctx.reply('Подтвердите или отмените.');
        createOrder({
          client_id: uid,
          from: state.data.from,
          to: state.data.to,
          size: state.data.size,
          cargo_type: 'other',
          fragile: false,
          thermobox: false,
          wait_minutes: 0,
          cash_change_needed: false,
          pay_type: 'cash',
          amount_total: state.data.price,
          amount_to_courier: state.data.price,
          payment_status: 'pending',
          comment: ''
        });
        states.delete(uid);
        return ctx.reply('Заказ создан', Markup.removeKeyboard());
      }
    }
  });
}
