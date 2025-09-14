<<<<<<< HEAD
<<<<<<< HEAD
import { Telegraf, Markup } from 'telegraf';
import { pointInPolygon } from '../utils/geo.js';
import { calcPrice } from '../utils/pricing.js';
import { getSettings } from '../services/settings.js';
import { getUser } from '../services/users.js';
<<<<<<< HEAD
import { createOrder } from '../services/orders.js';
=======
import {
  getOnlineCouriers,
  isOrderHiddenForCourier,
  hideOrderForCourier
} from '../services/courierState.js';
import {
  createOrder,
  updateOrder,
  reserveOrder,
  assignOrder,
  getOrder
} from '../services/orders.js';
import {
  distanceKm,
  etaMinutes,
  calcPrice,
  isInAlmaty,
  isNight
} from '../utils/geo.js';
import type { Coord } from '../utils/geo.js';
=======
import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import {
  parse2GisLink,
  reverseGeocode,
  normalizeAddress,
  pointDeeplink,
  routeDeeplink,
  routeToDeeplink,
  Point,
} from '../utils/twoGis.js';
import { getSettings } from '../services/settings.js';
import { createOrder } from '../services/orders.js';
import { getUser } from '../services/users.js';
import { distanceKm, etaMinutes, isInAlmaty, isNight } from '../utils/geo.js';
import { calcPrice } from '../utils/pricing.js';
>>>>>>> 7534cf0 (feat: add night coefficient)

type Step =
  | 'idle'
  | 'type'
  | 'from_method'
  | 'from_geo_wait'
  | 'from_address_wait'
  | 'from_link_wait'
  | 'to_method'
  | 'to_geo_wait'
  | 'to_address_wait'
  | 'to_link_wait'
  | 'time'
  | 'time_input'
  | 'size'
  | 'fragile'
  | 'thermobox'
  | 'comment'
  | 'confirm';
>>>>>>> 0fd3a32 (feat: driver availability and order hide)

interface WizardState {
<<<<<<< HEAD
  step: 'from' | 'to' | 'size' | 'confirm';
=======
  step: Step;
>>>>>>> 7534cf0 (feat: add night coefficient)
=======
import { Telegraf, Markup, Context } from 'telegraf';
import { parse2GisLink } from '../utils/twoGis.js';
import { createOrder } from '../services/orders.js';
import { getSettings } from '../services/settings.js';
import { getUser } from '../services/users.js';

interface WizardState {
  step:
    | 'idle'
    | 'type'
    | 'from'
    | 'to'
    | 'size'
    | 'fragile'
    | 'thermobox'
    | 'change'
    | 'pay'
    | 'comment'
    | 'confirm';
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
  data: any;
}

const states = new Map<number, WizardState>();
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
=======
const pendingP2P = new Map<number, number>();
const reservationTimers = new Map<number, NodeJS.Timeout>();

function publishOrder(order: any, bot: Telegraf) {
  const text = `Новый заказ #${order.id}\nОткуда: ${order.from.addr}\nКуда: ${order.to.addr}`;
  const buttons: any[] = [];
  if (order.from.lat && order.to.lat) {
    buttons.push([Markup.button.url('Маршрут в 2ГИС', routeDeeplink({ from: order.from, to: order.to }))]);
    buttons.push([Markup.button.url('До точки B', routeToDeeplink(order.to))]);
  }
  buttons.push([Markup.button.callback('Детали', `details_${order.id}`)]);
  buttons.push([Markup.button.callback('Скрыть на 1 час', `hide_${order.id}`)]);
  buttons.push([Markup.button.callback('Принять', `accept_${order.id}`)]);
  for (const courierId of getOnlineCouriers()) {
    if (isOrderHiddenForCourier(courierId, order.id)) continue;
    bot.telegram.sendMessage(courierId, text, {
      reply_markup: { inline_keyboard: buttons }
    }).catch(() => {});
  }
}
=======
>>>>>>> 7534cf0 (feat: add night coefficient)
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)

function startWizard(ctx: Context) {
  states.set(ctx.from!.id, { step: 'type', data: {} });
  ctx.reply(
    'Что доставляем?',
    Markup.keyboard([
      ['Документы', 'Посылка'],
      ['Еда', 'Другое'],
      ['Отмена'],
    ]).resize(),
  );
}

async function sendPointInfo(
  ctx: Context,
  point: Point,
  label: 'from' | 'to',
  state: WizardState,
) {
  const addrRaw = await reverseGeocode(point);
  const addr = addrRaw ? normalizeAddress(addrRaw) : '2ГИС точка';
  state.data[label] = { addr, ...point };
  const buttons = [
    Markup.button.url('Открыть в 2ГИС', pointDeeplink(point)),
    Markup.button.url('До точки B', routeToDeeplink(point)),
  ];
  if (state.data.from && state.data.to) {
    const routeLink = routeDeeplink({ from: state.data.from, to: state.data.to });
    buttons.push(Markup.button.url('Маршрут', routeLink));
  }
  await ctx.reply(
    `${label === 'from' ? 'Откуда' : 'Куда'}: ${addr}`,
    Markup.inlineKeyboard(buttons, { columns: 1 }),
  );
}
>>>>>>> 0fd3a32 (feat: driver availability and order hide)

export default function orderCommands(bot: Telegraf) {
  bot.hears('Создать заказ', (ctx) => {
<<<<<<< HEAD
    const settings = getSettings();
    const start = settings.order_hours_start ?? 8;
    const end = settings.order_hours_end ?? 23;
    const hour = (new Date().getUTCHours() + 6) % 24;
    if (hour < start || hour >= end) {
      return ctx.reply(`Заказы принимаются с ${start.toString().padStart(2,'0')}:00 до ${end.toString().padStart(2,'0')}:00 по времени Алматы.`);
    }
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
    const user = getUser(ctx.from!.id);
<<<<<<< HEAD
    if (!user || !user.agreed) return ctx.reply('Сначала поделитесь контактом и согласитесь с правилами через /start');
    states.set(ctx.from!.id, { step: 'from', data: {} });
    ctx.reply(
      'Отправьте геолокацию точки отправления',
      Markup.keyboard([[Markup.button.locationRequest('Отправить гео')], ['Отмена']]).resize()
    );
=======
    if (!user || !user.agreed) {
      return ctx.reply('Сначала поделитесь контактом и согласитесь с правилами через /start');
    }
    startWizard(ctx);
>>>>>>> 7534cf0 (feat: add night coefficient)
  });

  bot.hears('Отмена', (ctx) => {
    states.delete(ctx.from!.id);
    ctx.reply('Заказ отменён', Markup.removeKeyboard());
  });

<<<<<<< HEAD
  bot.on('location', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
<<<<<<< HEAD
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
=======
    const point: Point = {
      lat: ctx.message.location.latitude,
      lon: ctx.message.location.longitude,
    };
    if (!isInAlmaty(point)) {
      return ctx.reply('Точка вне Алматы. Отправьте другую.');
    }
    if (state.step === 'from_geo_wait') {
      await sendPointInfo(ctx, point, 'from', state);
      state.step = 'to_method';
      return ctx.reply(
        'Куда? Выберите способ ввода.',
        Markup.keyboard([
          ['Гео', 'Адрес', '2ГИС‑ссылка'],
          ['Отмена'],
        ]).resize(),
      );
    }
    if (state.step === 'to_geo_wait') {
      await sendPointInfo(ctx, point, 'to', state);
      state.step = 'time';
      return ctx.reply(
        'Когда доставить?',
        Markup.keyboard([
          ['Сейчас', 'К времени'],
          ['Отмена'],
        ]).resize(),
      );
>>>>>>> 7534cf0 (feat: add night coefficient)
    }
  });

  bot.on('text', (ctx) => {
=======
  bot.on('text', async (ctx) => {
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const text = ctx.message.text.trim();
<<<<<<< HEAD
    if (!state) return;
    switch (state.step) {
<<<<<<< HEAD
=======
    switch (state.step) {
      case 'type': {
        const map: Record<string, string> = {
          'Документы': 'docs',
          'Посылка': 'parcel',
          'Еда': 'food',
          'Другое': 'other'
        };
        const cargo = map[text];
        if (!cargo) {
          return ctx.reply('Выберите вариант из клавиатуры.');
        }
        state.data.cargo_type = cargo;
        state.step = 'from';
        return ctx.reply('Откуда? Отправьте адрес или ссылку 2ГИС.');
      }
      case 'from': {
        const parsed = await parse2GisLink(text);
        if (parsed && 'from' in parsed) {
          state.data.from = { addr: '2ГИС точка', lat: parsed.from.lat, lon: parsed.from.lon };
          state.data.to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
          state.step = 'size';
          await ctx.reply('Получатель уже указан из ссылки.');
          return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
        }
        if (parsed) {
          state.data.from = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
        } else {
          state.data.from = { addr: text };
        }
        state.step = 'to';
        return ctx.reply('Куда? Отправьте адрес или ссылку 2ГИС.');
      }
      case 'to': {
        const parsed = await parse2GisLink(text);
        if (parsed) {
          if ('from' in parsed) {
            state.data.to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
          } else {
            state.data.to = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
          }
        } else {
          state.data.to = { addr: text };
        }
        state.step = 'size';
        return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
      }
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
      case 'size': {
        if (!['S', 'M', 'L'].includes(text)) return ctx.reply('Выберите S, M или L.');
        state.data.size = text;
<<<<<<< HEAD
        const settings = getSettings();
        const { distance, price, night } = calcPrice(state.data.from, state.data.to, 0, state.data.size, settings);
        state.data.price = price;
        let summary = `Дистанция: ${distance.toFixed(1)} км\nСтоимость: ${price} ₸`;
        if (night) summary += '\nНочной коэффициент применён';
        state.step = 'confirm';
=======
        state.step = 'fragile';
        return ctx.reply('Хрупкое? (Да/Нет)', Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize());
      }
      case 'fragile': {
        state.data.fragile = text === 'Да';
        state.step = 'thermobox';
        return ctx.reply('Нужен термобокс? (Да/Нет)', Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize());
      }
      case 'thermobox': {
        state.data.thermobox = text === 'Да';
        state.step = 'change';
        return ctx.reply('Нужна сдача? (Да/Нет)', Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize());
      }
      case 'change': {
        state.data.cash_change_needed = text === 'Да';
        state.step = 'pay';
        return ctx.reply('Как оплатить?', Markup.keyboard([
          ['Наличные курьеру'],
          ['Перевод на карту'],
          ['Получатель платит'],
          ['Отмена']
        ]).resize());
      }
      case 'pay': {
        const map: Record<string, string> = {
          'Наличные курьеру': 'cash',
          'Перевод на карту': 'p2p',
          'Получатель платит': 'receiver'
        };
        const pay = map[text];
        if (!pay) return ctx.reply('Выберите вариант из клавиатуры.');
        state.data.pay_type = pay;
        state.step = 'comment';
        return ctx.reply('Комментарий? Если нет, отправьте "Пропустить".');
      }
      case 'comment': {
        if (text !== 'Пропустить') {
          state.data.comment = text;
        }
        state.step = 'confirm';
        const summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}`;
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
        return ctx.reply(summary, Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
      }
      case 'confirm': {
<<<<<<< HEAD
        if (text !== 'Подтвердить заказ') return ctx.reply('Подтвердите или отмените.');
        createOrder({
=======
        if (text !== 'Подтвердить заказ') {
          return ctx.reply('Подтвердите или отмените.');
        }
        const user = getUser(uid);
        if (!user) {
=======
      case 'type': {
        const map: Record<string, string> = {
          'Документы': 'docs',
          'Посылка': 'parcel',
          'Еда': 'food',
          'Другое': 'other',
        };
        const cargo = map[text];
        if (!cargo) return ctx.reply('Выберите вариант из клавиатуры.');
        state.data.cargo_type = cargo;
        state.step = 'from_method';
        return ctx.reply(
          'Откуда? Выберите способ ввода.',
          Markup.keyboard([
            ['Гео', 'Адрес', '2ГИС‑ссылка'],
            ['Отмена'],
          ]).resize(),
        );
      }
      case 'from_method': {
        if (text === 'Гео') {
          state.step = 'from_geo_wait';
          return ctx.reply(
            'Отправьте геолокацию.',
            Markup.keyboard([[Markup.button.locationRequest('Отправить гео')], ['Отмена']]).resize(),
          );
        }
        if (text === 'Адрес') {
          state.step = 'from_address_wait';
          return ctx.reply('Введите адрес.');
        }
        if (text === '2ГИС‑ссылка') {
          state.step = 'from_link_wait';
          return ctx.reply('Инструкция: в 2ГИС нажмите «Поделиться» → «Скопировать ссылку» и отправьте её сюда.');
        }
        return ctx.reply('Выберите вариант из клавиатуры.');
      }
      case 'from_address_wait': {
        state.data.from = { addr: text };
        state.step = 'to_method';
        return ctx.reply(
          'Куда? Выберите способ ввода.',
          Markup.keyboard([
            ['Гео', 'Адрес', '2ГИС‑ссылка'],
            ['Отмена'],
          ]).resize(),
        );
      }
      case 'from_link_wait': {
        const parsed = await parse2GisLink(text);
        if (!parsed) return ctx.reply('Не удалось разобрать ссылку.');
        if ('from' in parsed) {
          if (!isInAlmaty(parsed.from) || !isInAlmaty(parsed.to)) {
            return ctx.reply('Точки вне Алматы. Отправьте другую ссылку.');
          }
          await sendPointInfo(ctx, parsed.from, 'from', state);
          await sendPointInfo(ctx, parsed.to, 'to', state);
          state.step = 'time';
          return ctx.reply(
            'Когда доставить?',
            Markup.keyboard([
              ['Сейчас', 'К времени'],
              ['Отмена'],
            ]).resize(),
          );
        }
        if (!isInAlmaty(parsed)) {
          return ctx.reply('Точка вне Алматы. Отправьте другую ссылку.');
        }
        await sendPointInfo(ctx, parsed, 'from', state);
        state.step = 'to_method';
        return ctx.reply(
          'Куда? Выберите способ ввода.',
          Markup.keyboard([
            ['Гео', 'Адрес', '2ГИС‑ссылка'],
            ['Отмена'],
          ]).resize(),
        );
      }
      case 'to_method': {
        if (text === 'Гео') {
          state.step = 'to_geo_wait';
          return ctx.reply(
            'Отправьте геолокацию.',
            Markup.keyboard([[Markup.button.locationRequest('Отправить гео')], ['Отмена']]).resize(),
          );
        }
        if (text === 'Адрес') {
          state.step = 'to_address_wait';
          return ctx.reply('Введите адрес.');
        }
        if (text === '2ГИС‑ссылка') {
          state.step = 'to_link_wait';
          return ctx.reply('Инструкция: в 2ГИС нажмите «Поделиться» → «Скопировать ссылку» и отправьте её сюда.');
        }
        return ctx.reply('Выберите вариант из клавиатуры.');
      }
      case 'to_address_wait': {
        state.data.to = { addr: text };
        state.step = 'time';
        return ctx.reply(
          'Когда доставить?',
          Markup.keyboard([
            ['Сейчас', 'К времени'],
            ['Отмена'],
          ]).resize(),
        );
      }
      case 'to_link_wait': {
        const parsed = await parse2GisLink(text);
        if (!parsed) return ctx.reply('Не удалось разобрать ссылку.');
        if ('from' in parsed) {
          if (!isInAlmaty(parsed.from) || !isInAlmaty(parsed.to)) {
            return ctx.reply('Точки вне Алматы. Отправьте другую ссылку.');
          }
          await sendPointInfo(ctx, parsed.from, 'from', state);
          await sendPointInfo(ctx, parsed.to, 'to', state);
        } else {
          if (!isInAlmaty(parsed)) {
            return ctx.reply('Точка вне Алматы. Отправьте другую ссылку.');
          }
          await sendPointInfo(ctx, parsed, 'to', state);
        }
        state.step = 'time';
        return ctx.reply(
          'Когда доставить?',
          Markup.keyboard([
            ['Сейчас', 'К времени'],
            ['Отмена'],
          ]).resize(),
        );
      }
      case 'time': {
        if (text === 'Сейчас') {
          state.data.delivery_time = new Date().toISOString();
        } else if (text === 'К времени') {
          state.step = 'time_input';
          return ctx.reply('Введите время в формате ЧЧ:ММ.');
        } else {
          return ctx.reply('Выберите вариант из клавиатуры.');
        }
        state.step = 'size';
        return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
      }
      case 'time_input': {
        const [hStr, mStr] = text.split(':');
        const h = Number(hStr);
        const m = Number(mStr);
        if (isNaN(h) || isNaN(m)) return ctx.reply('Неверный формат.');
        const now = new Date();
        const dt = new Date();
        dt.setHours(h, m, 0, 0);
        if (dt < now) return ctx.reply('Время уже прошло.');
        state.data.delivery_time = dt.toISOString();
        state.step = 'size';
        return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
      }
      case 'size': {
        if (!['S', 'M', 'L'].includes(text)) return ctx.reply('Выберите вариант из клавиатуры.');
        state.data.size = text;
        state.step = 'fragile';
        return ctx.reply('Хрупкое?', Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize());
      }
      case 'fragile': {
        if (!['Да', 'Нет'].includes(text)) return ctx.reply('Выберите вариант из клавиатуры.');
        state.data.fragile = text === 'Да';
        state.step = 'thermobox';
        return ctx.reply('Нужен термобокс?', Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize());
      }
      case 'thermobox': {
        if (!['Да', 'Нет'].includes(text)) return ctx.reply('Выберите вариант из клавиатуры.');
        state.data.thermobox = text === 'Да';
        state.step = 'comment';
        return ctx.reply('Комментарий к заказу? Если нет, отправьте "-".');
      }
      case 'comment': {
        if (text !== '-') state.data.comment = text;
        const base = getSettings();
        const settings = { ...base, night_active: base.night_active ?? isNight(new Date()) };
        const { distance, price } = calcPrice(
          state.data.from,
          state.data.to,
          0,
          state.data.size,
          settings,
        );
        const eta = etaMinutes(distance);
        state.data.summary = { distance, price, eta };
        state.step = 'confirm';
        return ctx.reply(
          `Дистанция: ${distance.toFixed(2)} км\nЦена: ${price} ₸\nВремя в пути: ~${eta} мин\nПодтвердить заказ?`,
          Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize(),
        );
      }
      case 'confirm': {
        if (text === 'Да') {
          await createOrder(uid, state.data);
>>>>>>> 7534cf0 (feat: add night coefficient)
          states.delete(uid);
          return ctx.reply('Заказ создан.', Markup.removeKeyboard());
        }
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
        const payment_status = state.data.pay_type === 'cash' ? 'pending' : 'awaiting_confirm';
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
        const order = createOrder({
>>>>>>> f6a2c0c (feat: add receiver payment flow and secure data)
          client_id: uid,
          from: state.data.from,
          to: state.data.to,
          size: state.data.size,
<<<<<<< HEAD
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
=======
          fragile: state.data.fragile,
          thermobox: state.data.thermobox,
          cash_change_needed: state.data.cash_change_needed,
          pay_type: state.data.pay_type,
          comment: state.data.comment
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
        });
        states.delete(uid);
<<<<<<< HEAD
        return ctx.reply('Заказ создан', Markup.removeKeyboard());
=======
        await ctx.reply(`Заказ #${order.id} создан.`, Markup.removeKeyboard());
<<<<<<< HEAD
        if (order.pay_type === 'p2p') {
          const msg = await ctx.reply('Реквизиты для оплаты: 1234567890\nПосле перевода отправьте скрин или ID.');
          setTimeout(() => {
            ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          }, 2 * 60 * 60 * 1000);
          pendingP2P.set(uid, order.id);
        }
<<<<<<< HEAD
        if (order.pay_type === 'receiver') {
          const msg = await ctx.reply('Передайте получателю: оплатить заказ курьеру при получении.');
          setTimeout(() => {
            ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          }, 2 * 60 * 60 * 1000);
        }
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
        const settings = getSettings();
        if (settings.drivers_channel_id) {
          const text = `Новый заказ #${order.id}\nОткуда: ${order.from.addr}\nКуда: ${order.to.addr}`;
          await ctx.telegram.sendMessage(settings.drivers_channel_id, text);
        }
=======
        publishOrder(order, bot);
>>>>>>> 0fd3a32 (feat: driver availability and order hide)
        return;
>>>>>>> f6a2c0c (feat: add receiver payment flow and secure data)
      }
    }
  });
<<<<<<< HEAD
<<<<<<< HEAD
=======

  bot.action(/accept_(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match[1]);
    const reserved = reserveOrder(orderId, ctx.from!.id);
    if (!reserved) {
      return ctx.answerCbQuery('Заказ уже взят или в работе');
    }
    ctx.answerCbQuery('Заказ забронирован на 90 секунд');
    const timer = setTimeout(async () => {
      const current = getOrder(orderId);
      if (current && current.status === 'reserved' && current.reserved_by === ctx.from!.id) {
        updateOrder(orderId, { status: 'open', reserved_by: undefined, reserved_until: undefined });
        await ctx.telegram.sendMessage(ctx.from!.id, `Бронь заказа #${orderId} истекла`);
        publishOrder(current, bot);
      }
    }, 90 * 1000);
    reservationTimers.set(orderId, timer);
  });

  bot.action(/start_(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match[1]);
    const assigned = assignOrder(orderId, ctx.from!.id);
    if (!assigned) {
      return ctx.answerCbQuery('Вы не бронировали этот заказ');
    }
    const timer = reservationTimers.get(orderId);
    if (timer) {
      clearTimeout(timer);
      reservationTimers.delete(orderId);
    }
    return ctx.answerCbQuery('Старт подтверждён');
=======
  bot.on('photo', async (ctx) => {
    const uid = ctx.from!.id;
    const orderId = pendingP2P.get(uid);
    if (!orderId) return;
    const settings = getSettings();
    if (settings.drivers_channel_id) {
      const photo = ctx.message.photo![ctx.message.photo!.length - 1]!;
      await ctx.telegram.sendPhoto(settings.drivers_channel_id, photo.file_id, {
        caption: `Платёж по заказу #${orderId}`
      });
    }
    pendingP2P.delete(uid);
    await ctx.reply('Спасибо, ожидайте подтверждения курьера.');
  });

  bot.action(/cash_paid:(\d+)/, async (ctx) => {
    const id = Number((ctx.match as RegExpExecArray)[1]);
    updateOrder(id, { payment_status: 'paid' });
    await ctx.answerCbQuery('Оплата подтверждена');
    await ctx.editMessageReplyMarkup(undefined);
  });

  bot.action(/p2p_confirm:(\d+)/, async (ctx) => {
    const id = Number((ctx.match as RegExpExecArray)[1]);
    updateOrder(id, { payment_status: 'paid' });
    await ctx.answerCbQuery('Поступление подтверждено');
    await ctx.editMessageReplyMarkup(undefined);
>>>>>>> bcad4d7 (feat: add payment fields and flows)
  });
>>>>>>> 0fd3a32 (feat: driver availability and order hide)
=======
        if (text === 'Нет') {
          states.delete(uid);
          return ctx.reply('Заказ отменён.', Markup.removeKeyboard());
        }
        return ctx.reply('Выберите вариант из клавиатуры.');
      }
    }
  });
>>>>>>> 7534cf0 (feat: add night coefficient)
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)
}

