import { Telegraf, Markup, Context } from 'telegraf';
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
import {
  parse2GisLink,
  reverseGeocode,
  normalizeAddress,
  pointDeeplink,
  routeDeeplink,
  routeToDeeplink
} from '../utils/twoGis.js';
=======
import { parse2GisLink } from '../utils/twoGis.js';
import { pointInPolygon } from '../utils/geo.js';
import { calcPrice } from '../utils/pricing.js';
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
import { createOrder } from '../services/orders.js';
=======
import { parse2GisLink } from '../utils/twoGis.js';
import {
  createOrder,
  updateOrder,
  reserveOrder,
  assignOrder
} from '../services/orders.js';
>>>>>>> 0cb5d4a (feat: add order reservation workflow)
=======
import { parse2GisLink } from '../utils/twoGis.js';
import { createOrder, updateOrder } from '../services/orders.js';
>>>>>>> bcad4d7 (feat: add payment fields and flows)
import { getSettings } from '../services/settings.js';
import { getUser } from '../services/users.js';
import {
  distanceKm,
  etaMinutes,
  calcPrice,
  isInAlmaty,
  isNight
} from '../utils/geo.js';
import type { Coord } from '../utils/geo.js';

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
  | 'change'
  | 'pay'
  | 'comment'
  | 'confirm';

interface WizardState {
<<<<<<< HEAD
  step: Step;
=======
  step:
    | 'idle'
    | 'type'
    | 'from'
    | 'from_confirm'
    | 'to'
    | 'to_confirm'
    | 'size'
    | 'fragile'
    | 'thermobox'
    | 'wait'
    | 'change'
    | 'pay'
    | 'amount_total'
    | 'amount_courier'
    | 'comment'
    | 'confirm';
>>>>>>> 3c7234d (feat: improve 2gis integration)
  data: any;
}

const states = new Map<number, WizardState>();
const pendingP2P = new Map<number, number>();

function startWizard(ctx: Context) {
  const uid = ctx.from!.id;
  states.set(uid, { step: 'type', data: {} });
  ctx.reply(
    'Что доставляем?',
    Markup.keyboard([
      ['Документы', 'Посылка'],
      ['Еда', 'Другое'],
      ['Отмена']
    ]).resize()
  );
}

export default function orderCommands(bot: Telegraf) {
  bot.hears('Создать заказ', (ctx) => {
    const hour = (new Date().getUTCHours() + 6) % 24;
    if (hour < 8 || hour >= 23) {
      return ctx.reply('Заказы принимаются с 08:00 до 23:00 по времени Алматы.');
    }
    const user = getUser(ctx.from!.id);
    if (!user || !user.agreed) return ctx.reply('Сначала поделитесь контактом и согласитесь с правилами через /start');
    startWizard(ctx);
  });

  bot.hears('Отмена', (ctx) => {
    states.delete(ctx.from!.id);
    ctx.reply('Заказ отменён.', Markup.removeKeyboard());
  });

  bot.on('location', (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    if (!state) return;
    const { latitude: lat, longitude: lon } = ctx.message.location;
    if (state.step === 'from_geo_wait') {
      if (!isInAlmaty({ lat, lon })) {
        return ctx.reply('Точка вне Алматы. Отправьте другую.');
      }
      state.data.from = { addr: 'Геолокация', lat, lon };
      state.step = 'to_method';
      return ctx.reply(
        'Куда? Выберите способ ввода.',
        Markup.keyboard([
          ['Гео', 'Адрес', '2ГИС‑ссылка'],
          ['Отмена']
        ]).resize()
      );
    }
    if (state.step === 'to_geo_wait') {
      if (!isInAlmaty({ lat, lon })) {
        return ctx.reply('Точка вне Алматы. Отправьте другую.');
      }
      state.data.to = { addr: 'Геолокация', lat, lon };
      state.step = 'time';
      return ctx.reply(
        'Когда доставить?',
        Markup.keyboard([
          ['Сейчас', 'К времени'],
          ['Отмена']
        ]).resize()
      );
    }
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const state = states.get(uid);
    const text = ctx.message.text.trim();
    if (!state) {
      const orderId = pendingP2P.get(uid);
      if (orderId) {
        const settings = getSettings();
        if (settings.drivers_channel_id) {
          await ctx.telegram.sendMessage(
            settings.drivers_channel_id,
            `Платёж по заказу #${orderId}: ${text}`
          );
        }
        pendingP2P.delete(uid);
        await ctx.reply('Спасибо, ожидайте подтверждения курьера.');
      }
      return;
    }
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
        state.step = 'from_method';
        return ctx.reply(
          'Откуда? Выберите способ ввода.',
          Markup.keyboard([
            ['Гео', 'Адрес', '2ГИС‑ссылка'],
            ['Отмена']
          ]).resize()
        );
      }
      case 'from_method': {
        if (text === 'Гео') {
          state.step = 'from_geo_wait';
          return ctx.reply(
            'Отправьте геолокацию.',
            Markup.keyboard([
              [Markup.button.locationRequest('Отправить гео')],
              ['Отмена']
            ]).resize()
          );
        }
        if (text === 'Адрес') {
          state.step = 'from_address_wait';
          return ctx.reply('Введите адрес.');
        }
        if (text === '2ГИС‑ссылка') {
          state.step = 'from_link_wait';
          return ctx.reply(
            'Инструкция: в 2ГИС нажмите «Поделиться» → «Скопировать ссылку» и отправьте её сюда.'
          );
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
            ['Отмена']
          ]).resize()
        );
      }
      case 'from_link_wait': {
        const parsed = await parse2GisLink(text);
<<<<<<< HEAD
<<<<<<< HEAD
        if (!parsed) return ctx.reply('Не удалось разобрать ссылку.');
        if ('from' in parsed) {
          if (!isInAlmaty(parsed.from) || !isInAlmaty(parsed.to)) {
            return ctx.reply('Точки вне Алматы. Отправьте другую ссылку.');
          }
          state.data.from = { addr: '2ГИС точка', lat: parsed.from.lat, lon: parsed.from.lon };
          state.data.to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
          await ctx.replyWithLocation(parsed.from.lat, parsed.from.lon);
          await ctx.replyWithLocation(parsed.to.lat, parsed.to.lon);
          state.step = 'time';
          return ctx.reply(
            'Когда доставить?',
            Markup.keyboard([
              ['Сейчас', 'К времени'],
              ['Отмена']
            ]).resize()
          );
        }
        if (!isInAlmaty(parsed)) {
          return ctx.reply('Точка вне Алматы. Отправьте другую ссылку.');
        }
        state.data.from = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
        await ctx.replyWithLocation(parsed.lat, parsed.lon);
        state.step = 'to_method';
        return ctx.reply(
          'Куда? Выберите способ ввода.',
          Markup.keyboard([
            ['Гео', 'Адрес', '2ГИС‑ссылка'],
            ['Отмена']
          ]).resize()
        );
      }
      case 'to_method': {
        if (text === 'Гео') {
          state.step = 'to_geo_wait';
          return ctx.reply(
            'Отправьте геолокацию.',
            Markup.keyboard([
              [Markup.button.locationRequest('Отправить гео')],
              ['Отмена']
            ]).resize()
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
            ['Отмена']
          ]).resize()
        );
      }
      case 'to_link_wait': {
        const parsed = await parse2GisLink(text);
        if (!parsed) return ctx.reply('Не удалось разобрать ссылку.');
        if ('from' in parsed) {
          if (!isInAlmaty(parsed.from) || !isInAlmaty(parsed.to)) {
            return ctx.reply('Точки вне Алматы. Отправьте другую ссылку.');
          }
          state.data.to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
          state.data.from = { addr: '2ГИС точка', lat: parsed.from.lat, lon: parsed.from.lon };
          await ctx.replyWithLocation(parsed.from.lat, parsed.from.lon);
          await ctx.replyWithLocation(parsed.to.lat, parsed.to.lon);
        } else {
          if (!isInAlmaty(parsed)) {
            return ctx.reply('Точка вне Алматы. Отправьте другую ссылку.');
          }
          state.data.to = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
          await ctx.replyWithLocation(parsed.lat, parsed.lon);
        }
        state.step = 'time';
        return ctx.reply(
          'Когда доставить?',
          Markup.keyboard([
            ['Сейчас', 'К времени'],
            ['Отмена']
          ]).resize()
        );
      }
      case 'time': {
        if (text === 'Сейчас') {
          state.data.delivery_time = 'now';
=======
        if (parsed && 'from' in parsed) {
          const fromAddr = await reverseGeocode(parsed.from);
          const toAddr = await reverseGeocode(parsed.to);
          state.data.from = {
            addr: fromAddr ? normalizeAddress(fromAddr) : '2ГИС точка',
            lat: parsed.from.lat,
            lon: parsed.from.lon
          };
          state.data.to = {
            addr: toAddr ? normalizeAddress(toAddr) : '2ГИС точка',
            lat: parsed.to.lat,
            lon: parsed.to.lon
          };
>>>>>>> 3c7234d (feat: improve 2gis integration)
=======
        const settings = getSettings();
        if (parsed && 'from' in parsed) {
          const from = { addr: '2ГИС точка', lat: parsed.from.lat, lon: parsed.from.lon };
          const to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
          if (settings.city_polygon && !pointInPolygon(from, settings.city_polygon)) {
            return ctx.reply('Адрес вне зоны обслуживания, отправьте другой адрес.');
          }
          if (settings.city_polygon && !pointInPolygon(to, settings.city_polygon)) {
            return ctx.reply('Адрес вне зоны обслуживания, отправьте другой адрес.');
          }
          state.data.from = from;
          state.data.to = to;
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
          state.step = 'size';
          return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
        }
<<<<<<< HEAD
<<<<<<< HEAD
        if (text === 'К времени') {
          state.step = 'time_input';
          return ctx.reply('Введите время в формате ЧЧ:ММ.');
=======
        if (parsed) {
          const from = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
          if (settings.city_polygon && !pointInPolygon(from, settings.city_polygon)) {
            return ctx.reply('Адрес вне зоны обслуживания, отправьте другой адрес.');
          }
          state.data.from = from;
        } else {
          state.data.from = { addr: text };
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
        }
        return ctx.reply('Выберите вариант из клавиатуры.');
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
=======
        if (parsed) {
          const addr = await reverseGeocode(parsed);
          if (addr) {
            state.data.from = { addr: normalizeAddress(addr), lat: parsed.lat, lon: parsed.lon };
            state.step = 'to';
            return ctx.reply('Куда? Отправьте адрес или ссылку 2ГИС.');
          }
          state.data.tmp = { point: parsed, text };
          state.step = 'from_confirm';
          return ctx.reply(
            'Не удалось определить адрес, использовать введённый? (Да/Нет)',
            Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize()
          );
        }
        state.data.from = { addr: normalizeAddress(text) };
        state.step = 'to';
        return ctx.reply('Куда? Отправьте адрес или ссылку 2ГИС.');
      }
      case 'from_confirm': {
        if (text === 'Да') {
          const { point, text: original } = state.data.tmp;
          state.data.from = {
            addr: normalizeAddress(original),
            lat: point.lat,
            lon: point.lon
          };
          delete state.data.tmp;
          state.step = 'to';
          return ctx.reply('Куда? Отправьте адрес или ссылку 2ГИС.');
        }
        if (text === 'Нет') {
          delete state.data.tmp;
          state.step = 'from';
          return ctx.reply('Откуда? Отправьте адрес или ссылку 2ГИС.');
        }
        return ctx.reply('Ответьте Да или Нет.');
      }
      case 'to': {
        const parsed = await parse2GisLink(text);
        const settings = getSettings();
        if (parsed) {
<<<<<<< HEAD
          const point = 'from' in parsed ? parsed.to : parsed;
          const addr = await reverseGeocode(point);
          if (addr) {
            state.data.to = { addr: normalizeAddress(addr), lat: point.lat, lon: point.lon };
            state.step = 'size';
            return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
=======
          if ('from' in parsed) {
            const to = { addr: '2ГИС точка', lat: parsed.to.lat, lon: parsed.to.lon };
            if (settings.city_polygon && !pointInPolygon(to, settings.city_polygon)) {
              return ctx.reply('Адрес вне зоны обслуживания, отправьте другой адрес.');
            }
            state.data.to = to;
          } else {
            const to = { addr: '2ГИС точка', lat: parsed.lat, lon: parsed.lon };
            if (settings.city_polygon && !pointInPolygon(to, settings.city_polygon)) {
              return ctx.reply('Адрес вне зоны обслуживания, отправьте другой адрес.');
            }
            state.data.to = to;
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
          }
          state.data.tmp = { point, text };
          state.step = 'to_confirm';
          return ctx.reply(
            'Не удалось определить адрес, использовать введённый? (Да/Нет)',
            Markup.keyboard([['Да', 'Нет'], ['Отмена']]).resize()
          );
        }
        state.data.to = { addr: normalizeAddress(text) };
>>>>>>> 3c7234d (feat: improve 2gis integration)
        state.step = 'size';
        return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
      }
      case 'to_confirm': {
        if (text === 'Да') {
          const { point, text: original } = state.data.tmp;
          state.data.to = {
            addr: normalizeAddress(original),
            lat: point.lat,
            lon: point.lon
          };
          delete state.data.tmp;
          state.step = 'size';
          return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
        }
        if (text === 'Нет') {
          delete state.data.tmp;
          state.step = 'to';
          return ctx.reply('Куда? Отправьте адрес или ссылку 2ГИС.');
        }
        return ctx.reply('Ответьте Да или Нет.');
      }
      case 'size': {
        if (!['S', 'M', 'L'].includes(text)) {
          return ctx.reply('Выберите S, M или L.');
        }
        state.data.size = text;
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
          state.step = 'wait';
          return ctx.reply('Сколько минут ожидания? (число)', Markup.keyboard([['0'], ['Отмена']]).resize());
        }
        case 'wait': {
          const wait = Number(text);
          if (isNaN(wait) || wait < 0) {
            return ctx.reply('Введите корректное число минут.');
          }
          state.data.wait_minutes = wait;
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
        state.step = 'amount_total';
        return ctx.reply('Введите общую стоимость заказа, ₸');
      }
      case 'amount_total': {
        const amt = parseFloat(text.replace(',', '.'));
        if (isNaN(amt)) {
          return ctx.reply('Введите число.');
        }
        state.data.amount_total = amt;
        state.step = 'amount_courier';
        return ctx.reply('Сумма курьеру, ₸');
      }
      case 'amount_courier': {
        const amt = parseFloat(text.replace(',', '.'));
        if (isNaN(amt)) {
          return ctx.reply('Введите число.');
        }
        state.data.amount_to_courier = amt;
        state.step = 'comment';
        return ctx.reply('Комментарий? Если нет, отправьте "Пропустить".');
      }
      case 'comment': {
<<<<<<< HEAD
        if (text !== 'Пропустить') {
          state.data.comment = text;
        }
        let summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}`;
        if (state.data.from.lat && state.data.to?.lat) {
          const from: Coord = { lat: state.data.from.lat, lon: state.data.from.lon };
          const to: Coord = { lat: state.data.to.lat, lon: state.data.to.lon };
          const dist = distanceKm(from, to);
          const eta = etaMinutes(dist);
          const night = isNight(state.data.delivery_time ? new Date(state.data.delivery_time) : new Date());
          const price = calcPrice(dist, state.data.size, {
            fragile: state.data.fragile,
            thermobox: state.data.thermobox,
            night
          });
          state.data.distance = dist;
          state.data.eta = eta;
          state.data.price = price;
          summary += `\nДистанция: ${dist.toFixed(1)} км\nETA: ${eta} мин\nЦена: ${price} тг`;
        }
        state.step = 'confirm';
<<<<<<< HEAD
<<<<<<< HEAD
=======
        const summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}\nСтоимость: ${state.data.amount_total}\nКурьеру: ${state.data.amount_to_courier}`;
>>>>>>> bcad4d7 (feat: add payment fields and flows)
        return ctx.reply(summary, Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
=======
        const summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}`;
        if (state.data.from.lat && state.data.to.lat) {
          await ctx.reply(
            summary,
            Markup.inlineKeyboard([
              [Markup.button.url('Открыть в 2ГИС', pointDeeplink(state.data.from as any))],
              [Markup.button.url('Маршрут в 2ГИС', routeDeeplink({ from: state.data.from as any, to: state.data.to as any }))],
              [Markup.button.url('До точки B', routeToDeeplink(state.data.to as any))]
            ])
          );
        } else {
          await ctx.reply(summary);
        }
        return ctx.reply('Подтвердите заказ', Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
>>>>>>> 3c7234d (feat: improve 2gis integration)
      }
      case 'confirm': {
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
        const payment_status = state.data.pay_type === 'p2p' ? 'awaiting_confirm' : 'pending';
        const order = createOrder({
          client_id: uid,
          cargo_type: state.data.cargo_type,
          from: state.data.from,
          to: state.data.to,
          size: state.data.size,
          fragile: state.data.fragile,
          thermobox: state.data.thermobox,
          cash_change_needed: state.data.cash_change_needed,
          pay_type: state.data.pay_type,
          amount_total: state.data.amount_total,
          amount_to_courier: state.data.amount_to_courier,
          payment_status,
          comment: state.data.comment
        });
=======
          const order = createOrder({
            client_id: uid,
            cargo_type: state.data.cargo_type,
            from: state.data.from,
            to: state.data.to,
            size: state.data.size,
            fragile: state.data.fragile,
            thermobox: state.data.thermobox,
            wait_minutes: state.data.wait_minutes,
            cash_change_needed: state.data.cash_change_needed,
            pay_type: state.data.pay_type,
            comment: state.data.comment,
            distance_km: state.data.distance_km,
            price: state.data.price
          });
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
        states.delete(uid);
        await ctx.reply(`Заказ #${order.id} создан.`, Markup.removeKeyboard());
        if (order.pay_type === 'p2p') {
          const msg = await ctx.reply('Реквизиты для оплаты: 1234567890\nПосле перевода отправьте скрин или ID.');
          setTimeout(() => {
            ctx.telegram.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
          }, 2 * 60 * 60 * 1000);
          pendingP2P.set(uid, order.id);
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
      }
    }
  });

<<<<<<< HEAD
  bot.action(/accept_(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match[1]);
    const reserved = reserveOrder(orderId, ctx.from!.id);
    if (!reserved) {
      return ctx.answerCbQuery('Заказ уже взят или в работе');
    }
    const expire = new Date(reserved.reserved_until!).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const username = ctx.from?.username || ctx.from?.first_name || '';
    await ctx.editMessageText(
      `Новый заказ #${reserved.id}\nОткуда: ${reserved.from.addr}\nКуда: ${reserved.to.addr}\nЗабронирован: ${username} до ${expire}`,
      Markup.inlineKeyboard([[Markup.button.callback('Подтвердить старт', `start_${reserved.id}`)]])
    );
    const settings = getSettings();
    if (settings.drivers_channel_id) {
      await ctx.telegram.sendMessage(settings.drivers_channel_id, `Заказ #${reserved.id} принял ${username}`);
    }
    return ctx.answerCbQuery('Вы забронировали заказ на 90 сек');
  });

  bot.action(/start_(\d+)/, async (ctx) => {
    const orderId = Number(ctx.match[1]);
    const assigned = assignOrder(orderId, ctx.from!.id);
    if (!assigned) {
      return ctx.answerCbQuery('Вы не бронировали этот заказ');
    }
    const username = ctx.from?.username || ctx.from?.first_name || '';
    await ctx.editMessageText(
      `Заказ #${assigned.id}\nОткуда: ${assigned.from.addr}\nКуда: ${assigned.to.addr}\nВыполняет: ${username}`
    );
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
}
