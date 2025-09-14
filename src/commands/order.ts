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
<<<<<<< HEAD
        if (text !== 'Подтвердить заказ') return ctx.reply('Подтвердите или отмените.');
        createOrder({
=======
        if (text !== 'Подтвердить заказ') {
          return ctx.reply('Подтвердите или отмените.');
=======
          if (text !== 'Пропустить') {
            state.data.comment = text;
          }
          const settings = getSettings();
          const { distance, price } = calcPrice(
            state.data.from.lat && state.data.from.lon ? { lat: state.data.from.lat, lon: state.data.from.lon } : undefined,
            state.data.to.lat && state.data.to.lon ? { lat: state.data.to.lat, lon: state.data.to.lon } : undefined,
            state.data.wait_minutes || 0,
            state.data.size,
            settings
          );
          state.data.distance_km = distance;
          state.data.price = price;
          state.step = 'confirm';
          const summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}\nСтоимость: ${price} ₸`;
          return ctx.reply(summary, Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
        }
        case 'confirm': {
          if (text !== 'Подтвердить заказ') {
            return ctx.reply('Подтвердите или отмените.');
          }
        const user = getUser(uid);
        if (!user) {
          states.delete(uid);
          return ctx.reply('Не найден пользователь.');
        }
<<<<<<< HEAD
        const payment_status = state.data.pay_type === 'cash' ? 'pending' : 'awaiting_confirm';
        const order = createOrder({
>>>>>>> f6a2c0c (feat: add receiver payment flow and secure data)
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
<<<<<<< HEAD
        return ctx.reply('Заказ создан', Markup.removeKeyboard());
=======
        await ctx.reply(`Заказ #${order.id} создан.`, Markup.removeKeyboard());
        if (order.pay_type === 'p2p') {
          const msg = await ctx.reply('Реквизиты для оплаты: 1234567890\nПосле перевода отправьте скрин или ID.');
          setTimeout(() => {
            ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          }, 2 * 60 * 60 * 1000);
          pendingP2P.set(uid, order.id);
        }
        if (order.pay_type === 'receiver') {
          const msg = await ctx.reply('Передайте получателю: оплатить заказ курьеру при получении.');
          setTimeout(() => {
            ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          }, 2 * 60 * 60 * 1000);
        }
        const settings = getSettings();
        if (settings.drivers_channel_id) {
          const text = `Новый заказ #${order.id}\nОткуда: ${order.from.addr}\nКуда: ${order.to.addr}`;
<<<<<<< HEAD
<<<<<<< HEAD
          const extra =
            order.from.lat && order.to.lat
              ? Markup.inlineKeyboard([
                  [Markup.button.url('Открыть в 2ГИС', pointDeeplink(order.from as any))],
                  [Markup.button.url('Маршрут в 2ГИС', routeDeeplink({ from: order.from as any, to: order.to as any }))],
                  [Markup.button.url('До точки B', routeToDeeplink(order.to as any))]
                ])
              : undefined;
          await ctx.telegram.sendMessage(settings.drivers_channel_id, text, extra ? extra : undefined);
=======
          const msg = await ctx.telegram.sendMessage(
            settings.drivers_channel_id,
            text,
            Markup.inlineKeyboard([
              [Markup.button.callback('Принять', `accept_${order.id}`)]
            ])
          );
          updateOrder(order.id, { message_id: msg.message_id });
>>>>>>> 0cb5d4a (feat: add order reservation workflow)
=======
          const buttons: any[] = [];
          if (order.pay_type === 'cash') {
            buttons.push(Markup.button.callback('Нал получены', `cash_paid:${order.id}`));
          }
          if (order.pay_type === 'p2p') {
            buttons.push(Markup.button.callback('Поступление проверил', `p2p_confirm:${order.id}`));
          }
          const extra = buttons.length
            ? { reply_markup: { inline_keyboard: [buttons] } }
            : undefined;
          await ctx.telegram.sendMessage(settings.drivers_channel_id, text, extra);
>>>>>>> bcad4d7 (feat: add payment fields and flows)
        }
        return;
>>>>>>> f6a2c0c (feat: add receiver payment flow and secure data)
      }
    }
  });
}
