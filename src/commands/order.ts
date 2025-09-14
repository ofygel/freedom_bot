import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { Point } from '../utils/twoGis';
import { parse2GisLink, routeToDeeplink } from '../utils/twoGis';
import { distanceKm, etaMinutes, isInAlmaty } from '../utils/geo';
import { calcPrice } from '../utils/pricing';
import { getSettings } from '../services/settings';
import { createOrder } from '../services/orders';
import { geocodeAddress, reverseGeocode } from '../utils/geocode';

interface OrderSession {
  step: number;
  type?: string;
  from?: Point;
  to?: Point;
  time?: string; // formatted for display
  timeAt?: string; // ISO string for calculations
  size?: 'S' | 'M' | 'L';
  options?: string[];
  payment?: string;
  comment?: string;
}

const sessions = new Map<number, OrderSession>();

const optionLabels = ['Хрупкое', 'Опломбировать'];

function dimsKeyboard(s: OrderSession) {
  const sizeRow = ['S', 'M', 'L'].map((v) =>
    Markup.button.callback(
      s.size === v ? `\u2714\ufe0f ${v}` : v,
      `size:${v}`
    )
  );
  const optionRow = optionLabels.map((o) =>
    Markup.button.callback(
      (s.options?.includes(o) ? '\u2611\ufe0f ' : '\u2610 ') + o,
      `opt:${o}`
    )
  );
  return Markup.inlineKeyboard([
    sizeRow,
    optionRow,
    [Markup.button.callback('Далее', 'dims:done')],
  ]);
}

async function parsePoint(input: string): Promise<Point | null> {
  if (/2gis\./i.test(input)) {
    return await parse2GisLink(input);
  }
  return await geocodeAddress(input);
}

export default function registerOrderCommands(bot: Telegraf<Context>) {
  bot.command('order', async (ctx) => {
    const settings = getSettings();
    const start = settings.order_hours_start ?? 8;
    const end = settings.order_hours_end ?? 23;
    const hour = new Date().getHours();
    if (hour < start || hour >= end) {
      await ctx.reply(`Приём заказов с ${start.toString().padStart(2, '0')}:00 до ${end
        .toString()
        .padStart(2, '0')}:00`);
      return;
    }
    sessions.set(ctx.from!.id, { step: 1 });
    await ctx.reply(
      'Выберите тип заказа',
      Markup.keyboard(['Доставка', 'Пассажир']).oneTime().resize()
    );
  });

  bot.on('message', async (ctx, next) => {
    const s = sessions.get(ctx.from!.id);
    if (!s) return next();
    const msg: any = ctx.message;
    const text: string | undefined = msg.text;
    const loc = msg.location ? { lat: msg.location.latitude, lon: msg.location.longitude } : undefined;

    switch (s.step) {
      case 1:
        if (!text) return;
        s.type = text;
        s.step = 2;
        await ctx.reply('Откуда? Пришлите геолокацию, адрес или ссылку 2ГИС');
        break;
      case 2: {
        let point: Point | null = loc ?? (text ? await parsePoint(text) : null);
        if (!point || !isInAlmaty(point)) {
          await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
          return;
        }
        s.from = point;
        const addr = await reverseGeocode(point);
        await ctx.reply(`A: ${addr}`, Markup.inlineKeyboard([
          [Markup.button.url('Открыть в 2ГИС', `https://2gis.kz/almaty?m=${point.lon},${point.lat}`)]
        ]));
        s.step = 3;
        await ctx.reply('Куда?');
        break;
      }
      case 3: {
        let point: Point | null = loc ?? (text ? await parsePoint(text) : null);
        if (!point || !isInAlmaty(point)) {
          await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
          return;
        }
        s.to = point;
        const addr = await reverseGeocode(point);
        await ctx.reply(`B: ${addr}`, Markup.inlineKeyboard([
          [Markup.button.url('Открыть в 2ГИС', `https://2gis.kz/almaty?m=${point.lon},${point.lat}`)]
        ]));
        s.step = 4;
        await ctx.reply(
          'Когда?',
          Markup.keyboard(['Сейчас', 'К времени']).oneTime().resize()
        );
        break;
      }
      case 4:
        if (!text) return;
        if (text === 'Сейчас') {
          s.time = 'Сейчас';
          s.timeAt = new Date().toISOString();
          s.step = 5;
          await ctx.reply('Габариты/Опции?', dimsKeyboard(s));
        } else if (text === 'К времени') {
          s.step = 41;
          await ctx.reply('Укажите дату и время (YYYY-MM-DD HH:mm)');
        } else {
          const dt = new Date(text.replace(' ', 'T'));
          if (isNaN(dt.getTime()) || dt.getTime() < Date.now()) {
            await ctx.reply('Введите будущую дату и время в формате YYYY-MM-DD HH:mm');
            return;
          }
          s.time = dt.toLocaleString('ru-RU');
          s.timeAt = dt.toISOString();
          s.step = 5;
          await ctx.reply('Габариты/Опции?', dimsKeyboard(s));
        }
        break;
      case 41:
        if (!text) return;
        const dt = new Date(text.replace(' ', 'T'));
        if (isNaN(dt.getTime()) || dt.getTime() < Date.now()) {
          await ctx.reply('Введите будущую дату и время в формате YYYY-MM-DD HH:mm');
          return;
        }
        s.time = dt.toLocaleString('ru-RU');
        s.timeAt = dt.toISOString();
        s.step = 5;
        await ctx.reply('Габариты/Опции?', dimsKeyboard(s));
        break;
      case 5:
        return; // waiting for button callbacks
      case 6:
        if (!text) return;
        s.payment = text;
        s.step = 7;
        await ctx.reply('Комментарий?');
        break;
      case 7:
        if (!text) return;
        s.comment = text;
        const from = s.from!, to = s.to!;
        const dist = distanceKm(from, to);
        const eta = etaMinutes(dist);
        const price = calcPrice(dist, s.size || 'M', new Date(s.timeAt!));
        const fromAddr = await reverseGeocode(from);
        const toAddr = await reverseGeocode(to);
        await ctx.reply([
          `Тип: ${s.type}`,
          `Откуда: ${fromAddr}`,
          `Куда: ${toAddr}`,
          `Время: ${s.time}`,
          `Оплата: ${s.payment}`,
          `Габариты: ${s.size}`,
          `Опции: ${s.options?.join(', ') || 'нет'}`,
          `Комментарий: ${s.comment}`,
          `Расстояние: ${dist.toFixed(1)} км`,
          `Оценка времени: ~${eta} мин`,
          `Оценка цены: ~${price} ₸`,
        ].join('\n'), Markup.inlineKeyboard([
          [Markup.button.url('Открыть в 2ГИС', `https://2gis.kz/almaty?m=${from.lon},${from.lat}`)],
          [Markup.button.url('Маршрут', routeToDeeplink(from, to))],
          [Markup.button.url('До точки B', `https://2gis.kz/almaty?m=${to.lon},${to.lat}`)],
        ]));

        const payType =
          s.payment === 'Карта'
            ? 'card'
            : s.payment === 'Получатель платит'
            ? 'receiver'
            : 'cash';

        const order = createOrder({
          customer_id: ctx.from!.id,
          from,
          to,
          type: s.type!,
          time: s.time!,
          options: s.options?.join(', ') || null,
          size: s.size || 'M',
          pay_type: payType,
          comment: s.comment,
          price,
        });

        const settings = getSettings();
        if (settings.drivers_channel_id) {
          const card = [
            `#${order.id}`,
            `Откуда: ${fromAddr}`,
            `Куда: ${toAddr}`,
            `Время: ${s.time}`,
            `Оплата: ${s.payment}`,
            `Габариты: ${s.size}`,
            `Опции: ${s.options?.join(', ') || 'нет'}`,
            `Комментарий: ${s.comment}`,
            `Цена: ~${price} ₸`,
          ].join('\n');
          await ctx.telegram.sendMessage(
            settings.drivers_channel_id,
            card,
            Markup.inlineKeyboard([
              [
                Markup.button.url('Маршрут', routeToDeeplink(from, to)),
                Markup.button.url(
                  'До точки B',
                  `https://2gis.kz/almaty?m=${to.lon},${to.lat}`
                ),
              ],
              [
                Markup.button.callback('Резерв', `reserve:${order.id}`),
                Markup.button.callback('Детали', `details:${order.id}`),
                Markup.button.callback('Скрыть на 1 час', `hide:${order.id}`),
              ],
            ])
          );
        }

        await ctx.reply(`Заказ #${order.id} создан. Ожидайте курьера.`);

        if (s.payment === 'Получатель платит' && process.env.PROVIDER_TOKEN) {
          await ctx.replyWithInvoice({
            title: 'Оплата доставки',
            description: `Заказ на ~${price} ₸`,
            provider_token: process.env.PROVIDER_TOKEN,
            currency: 'KZT',
            prices: [{ label: 'Доставка', amount: Math.round(price * 100) }],
            payload: 'order_payment',
          });
        }
        sessions.delete(ctx.from!.id);
        break;
    }
  });

  bot.action(/size:(S|M|L)/, async (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s || s.step !== 5) return;
    s.size = ctx.match[1] as 'S' | 'M' | 'L';
    await ctx.editMessageReplyMarkup(dimsKeyboard(s).reply_markup);
    await ctx.answerCbQuery();
  });

  bot.action(/opt:(.+)/, async (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s || s.step !== 5) return;
    const opt = ctx.match[1];
    s.options = s.options ?? [];
    if (s.options.includes(opt)) {
      s.options = s.options.filter((o) => o !== opt);
    } else {
      s.options.push(opt);
    }
    await ctx.editMessageReplyMarkup(dimsKeyboard(s).reply_markup);
    await ctx.answerCbQuery();
  });

  bot.action('dims:done', async (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s || s.step !== 5) return;
    if (!s.size) {
      await ctx.answerCbQuery('Выберите габариты');
      return;
    }
    s.step = 6;
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply(
      'Оплата? (наличные/карта/получатель платит)',
      Markup.keyboard(['Наличные', 'Карта', 'Получатель платит'])
        .oneTime()
        .resize()
    );
    await ctx.answerCbQuery();
  });
}
