import { Telegraf, Markup, Context } from 'telegraf';
import { parse2GisLink } from '../utils/twoGis.js';
import { createOrder } from '../services/orders.js';
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
  step: Step;
  data: any;
}

const states = new Map<number, WizardState>();

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
    if (!state) return;
    const text = ctx.message.text.trim();
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
          state.step = 'size';
          return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
        }
        if (text === 'К времени') {
          state.step = 'time_input';
          return ctx.reply('Введите время в формате ЧЧ:ММ.');
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
        state.step = 'size';
        return ctx.reply('Размер: S, M или L?', Markup.keyboard([['S', 'M', 'L'], ['Отмена']]).resize());
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
        return ctx.reply(summary, Markup.keyboard([['Подтвердить заказ'], ['Отмена']]).resize());
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
          comment: state.data.comment
        });
        states.delete(uid);
        await ctx.reply(`Заказ #${order.id} создан.`, Markup.removeKeyboard());
        const settings = getSettings();
        if (settings.drivers_channel_id) {
          const text = `Новый заказ #${order.id}\nОткуда: ${order.from.addr}\nКуда: ${order.to.addr}`;
          await ctx.telegram.sendMessage(settings.drivers_channel_id, text);
        }
        return;
      }
    }
  });
}
