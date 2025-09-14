import type { Telegraf, Context } from 'telegraf';
import { parse2GisLink, routeToDeeplink } from '../utils/twoGis';
import { distanceKm, etaMinutes, isInAlmaty } from '../utils/geo';
import { calcPrice } from '../utils/pricing';
import { createOrder } from '../services/orders';
import { getSettings } from '../services/settings';

function extractLinks(text?: string): string[] {
  if (!text) return [];
  const re = /(https?:\/\/\S+)/g;
  return [...text.matchAll(re)].map(m => m[1]);
}

export default function registerOrderCommands(bot: Telegraf<Context>) {
  bot.command('order', async (ctx) => {
    const text = (ctx.message as any)?.text ?? '';
    const links = extractLinks(text);
    if (links.length < 2) {
      await ctx.reply('Формат: /order <ссылка_2ГИС_откуда> <ссылка_2ГИС_куда>');
      return;
    }
    const from = parse2GisLink(links[0]);
    const to = parse2GisLink(links[1]);
    if (!from || !to) {
      await ctx.reply('Не смог распарсить одну из ссылок. Дайте именно 2ГИС-ссылки с координатами.');
      return;
    }
    if (!isInAlmaty(from) || !isInAlmaty(to)) {
      await ctx.reply('Сервис работает в пределах Алматы. Укажите точки в городе.');
      return;
    }

    const dist = distanceKm(from, to);
    const eta = etaMinutes(dist);
    const price = calcPrice(dist, new Date());
    const order = createOrder({
      customer_id: ctx.from!.id,
      from, to,
      comment: text.replace(/.*https?:\/\/\S+\s+https?:\/\/\S+\s*/,'').trim() || null,
      price_estimate: price,
    });

    const s = getSettings();
    if (s.drivers_channel_id) {
      const deeplink = routeToDeeplink(from, to);
      await bot.telegram.sendMessage(
        Number(s.drivers_channel_id),
        [
          '��� Новый заказ',
          `Откуда → Куда: ${dist.toFixed(1)} км · ~${eta} мин`,
          `Оценка цены: ~${price} ₸`,
          deeplink ? `Маршрут: ${deeplink}` : '',
          `ID: #${order.id}`
        ].filter(Boolean).join('\n')
      );
    }

    await ctx.reply([
      `Заказ создан #${order.id}`,
      `Расстояние: ${dist.toFixed(2)} км`,
      `Оценка времени: ~${eta} мин`,
      `Оценка цены: ~${price} ₸`
    ].join('\n'));
  });
}
