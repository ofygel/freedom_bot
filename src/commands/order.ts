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
    if (!user) return ctx.reply('Сначала поделитесь контактом через /start');
    startWizard(ctx);
  });

  bot.hears('Отмена', (ctx) => {
    states.delete(ctx.from!.id);
    ctx.reply('Заказ отменён.', Markup.removeKeyboard());
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
        state.step = 'confirm';
        const summary = `Тип: ${state.data.cargo_type}\nОткуда: ${state.data.from.addr}\nКуда: ${state.data.to.addr}\nРазмер: ${state.data.size}\nОплата: ${state.data.pay_type}`;
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
