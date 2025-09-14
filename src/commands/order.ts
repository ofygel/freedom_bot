import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { Point } from '../utils/twoGis';
import { parse2GisLink, routeToDeeplink } from '../utils/twoGis';
import { distanceKm, etaMinutes, isInAlmaty } from '../utils/geo';
import { calcPrice } from '../utils/pricing';
import { geocodeAddress, reverseGeocode } from '../utils/geocode';

interface OrderSession {
  step: number;
  type?: string;
  from?: Point;
  to?: Point;
  time?: string;
  options?: string;
  payment?: string;
  comment?: string;
}

const sessions = new Map<number, OrderSession>();

async function parsePoint(input: string): Promise<Point | null> {
  if (/2gis\./i.test(input)) {
    return await parse2GisLink(input);
  }
  return await geocodeAddress(input);
}

export default function registerOrderCommands(bot: Telegraf<Context>) {
  bot.command('order', async (ctx) => {
    sessions.set(ctx.from!.id, { step: 1 });
    await ctx.reply('Выберите тип заказа', Markup.keyboard(['Доставка', 'Пассажир']).oneTime().resize());
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
        await ctx.reply('Когда? (время)');
        break;
      }
      case 4:
        if (!text) return;
        s.time = text;
        s.step = 5;
        await ctx.reply('Габариты/Опции?');
        break;
      case 5:
        if (!text) return;
        s.options = text;
        s.step = 6;
        await ctx.reply('Оплата? (наличные/карта)', Markup.keyboard(['Наличные', 'Карта']).oneTime().resize());
        break;
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
        const price = calcPrice(dist, new Date());
        const fromAddr = await reverseGeocode(from);
        const toAddr = await reverseGeocode(to);
        await ctx.reply([
          `Тип: ${s.type}`,
          `Откуда: ${fromAddr}`,
          `Куда: ${toAddr}`,
          `Время: ${s.time}`,
          `Оплата: ${s.payment}`,
          `Габариты/Опции: ${s.options}`,
          `Комментарий: ${s.comment}`,
          `Расстояние: ${dist.toFixed(1)} км`,
          `Оценка времени: ~${eta} мин`,
          `Оценка цены: ~${price} ₸`,
        ].join('\n'), Markup.inlineKeyboard([
          [Markup.button.url('Открыть в 2ГИС', `https://2gis.kz/almaty?m=${from.lon},${from.lat}`)],
          [Markup.button.url('Маршрут', routeToDeeplink(from, to))],
          [Markup.button.url('До точки B', `https://2gis.kz/almaty?m=${to.lon},${to.lat}`)],
        ]));
        sessions.delete(ctx.from!.id);
        break;
    }
  });
}
