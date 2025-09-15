import type { Context, Telegraf } from 'telegraf';
import { Markup } from 'telegraf';
import type { Point } from '../utils/twoGis';
import { parse2GisLink, routeToDeeplink } from '../utils/twoGis';
import { distanceKm, etaMinutes, isInAlmaty } from '../utils/geo';
import { calcPrice } from '../utils/pricing';
import { getSettings } from '../services/settings';
import {
  createOrder,
  getOrdersByClient,
  updateOrder,
  getOrder,
  updateOrderStatus,
} from '../services/orders';
import { geocodeAddress, reverseGeocode } from '../utils/geocode';
import { formatAddress } from '../utils/address';

type OrderType = 'docs' | 'parcel' | 'food' | 'other';

interface OrderSession {
  step: number;
  type?: OrderType;
  from?: Point;
  to?: Point;
  time?: string; // formatted for display
  timeAt?: string; // ISO string for calculations
  size?: 'S' | 'M' | 'L';
  options?: string[];
  payment?: string;
  comment?: string;
  msgId?: number;
  fromMsgId?: number;
  toMsgId?: number;
  fromEntrance?: string;
  fromFloor?: string;
  fromFlat?: string;
  fromIntercom?: string;
  toEntrance?: string;
  toFloor?: string;
  toFlat?: string;
  toIntercom?: string;
  addrExtra?: { target: 'from' | 'to'; field: 'entrance' | 'floor' | 'flat' | 'intercom' };
}

const sessions = new Map<number, OrderSession>();
const paymentPending = new Map<number, number>();

const typeButtons = ['Документы', 'Посылка', 'Еда', 'Другое'];
const typeMap: Record<string, OrderType> = {
  Документы: 'docs',
  Посылка: 'parcel',
  Еда: 'food',
  Другое: 'other',
};
const typeLabels: Record<OrderType, string> = {
  docs: 'Документы',
  parcel: 'Посылка',
  food: 'Еда',
  other: 'Другое',
};

const optionLabels = ['Хрупкое', 'Опломбировать', 'Термобокс', 'Нужна сдача'];
const twoGisHelp =
  'Чтобы отправить ссылку из 2ГИС:\n1. Найдите нужный адрес.\n2. Нажмите кнопку «Поделиться».\n3. Выберите «Скопировать ссылку» и отправьте её сюда.';

async function sendStep(
  ctx: Context,
  s: OrderSession,
  text: string,
  extra?: Parameters<typeof ctx.reply>[1]
) {
  if (s.msgId) {
    await ctx.telegram
      .deleteMessage(ctx.chat!.id, s.msgId)
      .catch(() => {});
  }
  const msg = await ctx.reply(text, extra);
  s.msgId = msg.message_id;
}

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

function addrExtraKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Подъезд', 'order:addr_extra:entrance'),
      Markup.button.callback('Этаж', 'order:addr_extra:floor'),
    ],
    [
      Markup.button.callback('Кв.', 'order:addr_extra:flat'),
      Markup.button.callback('Домофон', 'order:addr_extra:intercom'),
    ],
  ]);
}

function getExtras(s: OrderSession, target: 'from' | 'to') {
  return {
    entrance: (s as any)[`${target}Entrance`],
    floor: (s as any)[`${target}Floor`],
    flat: (s as any)[`${target}Flat`],
    intercom: (s as any)[`${target}Intercom`],
  };
}

async function sendAddrPreview(ctx: Context, s: OrderSession, target: 'from' | 'to') {
  const point = target === 'from' ? s.from! : s.to!;
  const addr = await reverseGeocode(point);
  const text = `${target === 'from' ? 'A' : 'B'}: ${formatAddress(addr, getExtras(s, target))}\nhttps://2gis.kz/almaty?m=${point.lon},${point.lat}`;
  const msg = await ctx.reply(text, addrExtraKeyboard());
  if (target === 'from') s.fromMsgId = msg.message_id;
  else s.toMsgId = msg.message_id;
}

async function updateAddrPreview(ctx: Context, s: OrderSession, target: 'from' | 'to') {
  const msgId = target === 'from' ? s.fromMsgId : s.toMsgId;
  if (!msgId) return;
  const point = target === 'from' ? s.from! : s.to!;
  const addr = await reverseGeocode(point);
  const text = `${target === 'from' ? 'A' : 'B'}: ${formatAddress(addr, getExtras(s, target))}\nhttps://2gis.kz/almaty?m=${point.lon},${point.lat}`;
  await ctx.telegram.editMessageText(ctx.chat!.id, msgId, undefined, text, {
    reply_markup: addrExtraKeyboard().reply_markup,
  });
}

async function parsePoint(
  input: string
): Promise<{ point: Point } | { from: Point; to: Point } | null> {
  if (/2gis\./i.test(input)) {
    return await parse2GisLink(input);
  }
  const p = await geocodeAddress(input);
  return p ? { point: p } : null;
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
    const msg = await ctx.reply(
      'Выберите тип заказа',
      Markup.keyboard(typeButtons).oneTime().resize()
    );
    sessions.set(ctx.from!.id, { step: 1, msgId: msg.message_id });
  });

  bot.hears('Оплатил(а)', async (ctx) => {
    const orders = getOrdersByClient(ctx.from!.id);
    const order = orders
      .slice()
      .reverse()
      .find(
        (o) =>
          o.pay_type === 'card' &&
          o.payment_status !== 'paid' &&
          o.status !== 'awaiting_confirm' &&
          o.status !== 'closed' &&
          o.status !== 'canceled'
      );
    if (!order) {
      await ctx.reply('Заказ для подтверждения не найден');
      return;
    }
    paymentPending.set(ctx.from!.id, order.id);
    updateOrder(order.id, { payment_status: 'pending' });
    await ctx.reply('Отправьте скриншот или ID перевода.');
  });

  bot.on('message', async (ctx, next) => {
    const pending = paymentPending.get(ctx.from!.id);
    const msg: any = ctx.message;
    if (pending) {
      const order = getOrder(pending);
      if (order) {
        if (msg.photo?.length) {
          const fileId = msg.photo[msg.photo.length - 1].file_id;
          if (order.courier_id)
            ctx.telegram
              .sendPhoto(order.courier_id, fileId, {
                caption: `Клиент отправил подтверждение оплаты по заказу #${order.id}`,
              })
              .catch(() => {});
        } else if (msg.text) {
          if (order.courier_id)
            ctx.telegram
              .sendMessage(
                order.courier_id,
                `Клиент отправил подтверждение оплаты по заказу #${order.id}: ${msg.text}`
              )
              .catch(() => {});
        } else {
          await ctx.reply('Отправьте скриншот или ID перевода.');
          return;
        }
        updateOrderStatus(order.id, 'awaiting_confirm');
        await ctx.reply('Спасибо! Ожидайте подтверждения.');
      }
      paymentPending.delete(ctx.from!.id);
      return;
    }

    const s = sessions.get(ctx.from!.id);
    if (!s) return next();
    const text: string | undefined = msg.text;
    const loc = msg.location ? { lat: msg.location.latitude, lon: msg.location.longitude } : undefined;

    if (s.addrExtra) {
      if (!text) return;
      const { target, field } = s.addrExtra;
      const map: Record<string, string> = {
        entrance: 'Entrance',
        floor: 'Floor',
        flat: 'Flat',
        intercom: 'Intercom',
      };
      (s as any)[`${target}${map[field]}`] = text;
      await updateAddrPreview(ctx, s, target);
      s.addrExtra = undefined;
      return;
    }

    switch (s.step) {
      case 1:
        if (!text) return;
        const t = typeMap[text];
        if (!t) {
          await ctx.reply(
            'Выберите тип заказа',
            Markup.keyboard(typeButtons).oneTime().resize()
          );
          return;
        }
        s.type = t;
        s.step = 2;
        await sendStep(
          ctx,
          s,
          'Откуда? Пришлите геолокацию, адрес или ссылку 2ГИС',
          Markup.inlineKeyboard([
            [Markup.button.callback('Как отправить ссылку из 2ГИС', 'order:2gis')],
          ])
        );
        break;
      case 2: {
        const parsed = loc ? { point: loc } : text ? await parsePoint(text) : null;
        if (!parsed) {
          await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
          return;
        }
        if ('from' in parsed) {
          const { from, to } = parsed;
          if (!isInAlmaty(from) || !isInAlmaty(to)) {
            await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
            return;
          }
          s.from = from;
          s.to = to;
          await sendAddrPreview(ctx, s, 'from');
          await sendAddrPreview(ctx, s, 'to');
          s.step = 4;
          await sendStep(
            ctx,
            s,
            'Когда?',
            Markup.keyboard(['Сейчас', 'К времени']).oneTime().resize()
          );
        } else {
          const { point } = parsed;
          if (!isInAlmaty(point)) {
            await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
            return;
          }
          s.from = point;
          await sendAddrPreview(ctx, s, 'from');
          s.step = 3;
          await sendStep(
            ctx,
            s,
            'Куда? Пришлите геолокацию, адрес или ссылку 2ГИС',
            Markup.inlineKeyboard([
              [Markup.button.callback('Как отправить ссылку из 2ГИС', 'order:2gis')],
            ])
          );
        }
        break;
      }
      case 3: {
        const parsed = loc ? { point: loc } : text ? await parsePoint(text) : null;
        if (!parsed) {
          await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
          return;
        }
        if ('from' in parsed) {
          const { from, to } = parsed;
          if (!isInAlmaty(from) || !isInAlmaty(to)) {
            await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
            return;
          }
          s.from = from;
          s.to = to;
          await sendAddrPreview(ctx, s, 'from');
          await sendAddrPreview(ctx, s, 'to');
          s.step = 4;
          await sendStep(
            ctx,
            s,
            'Когда?',
            Markup.keyboard(['Сейчас', 'К времени']).oneTime().resize()
          );
        } else {
          const { point } = parsed;
          if (!isInAlmaty(point)) {
            await ctx.reply('Не удалось определить точку в пределах Алматы. Попробуйте ещё раз.');
            return;
          }
          s.to = point;
          await sendAddrPreview(ctx, s, 'to');
          s.step = 4;
          await sendStep(
            ctx,
            s,
            'Когда?',
            Markup.keyboard(['Сейчас', 'К времени']).oneTime().resize()
          );
        }
        break;
      }
      case 4:
        if (!text) return;
        if (text === 'Сейчас') {
          s.time = 'Сейчас';
          s.timeAt = new Date().toISOString();
          s.step = 5;
          await sendStep(ctx, s, 'Габариты/Опции?', dimsKeyboard(s));
        } else if (text === 'К времени') {
          s.step = 41;
          await sendStep(ctx, s, 'Укажите дату и время (YYYY-MM-DD HH:mm)');
        } else {
          const dt = new Date(text.replace(' ', 'T'));
          if (isNaN(dt.getTime()) || dt.getTime() < Date.now()) {
            await ctx.reply('Введите будущую дату и время в формате YYYY-MM-DD HH:mm');
            return;
          }
          s.time = dt.toLocaleString('ru-RU');
          s.timeAt = dt.toISOString();
          s.step = 5;
          await sendStep(ctx, s, 'Габариты/Опции?', dimsKeyboard(s));
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
        await sendStep(ctx, s, 'Габариты/Опции?', dimsKeyboard(s));
        break;
      case 5:
        return; // waiting for button callbacks
      case 6:
        if (!text) return;
        s.payment = text;
        s.step = 7;
        await sendStep(ctx, s, 'Комментарий?');
        break;
      case 7:
        if (!text) return;
        s.comment = text;
        if (s.msgId) {
          await ctx.telegram.deleteMessage(ctx.chat!.id, s.msgId).catch(() => {});
        }
        const from = s.from!, to = s.to!;
        const dist = distanceKm(from, to);
        const eta = etaMinutes(dist);
        const { price, nightApplied } = calcPrice(
          dist,
          s.size || 'M',
          new Date(s.timeAt!),
          s.type!,
          s.options || []
        );
        const fromAddr = formatAddress(await reverseGeocode(from), {
          entrance: s.fromEntrance,
          floor: s.fromFloor,
          flat: s.fromFlat,
          intercom: s.fromIntercom,
        });
        const toAddr = formatAddress(await reverseGeocode(to), {
          entrance: s.toEntrance,
          floor: s.toFloor,
          flat: s.toFlat,
          intercom: s.toIntercom,
        });
        const summary = [
          `Тип: ${typeLabels[s.type!]}`,
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
        ];
        if (nightApplied) {
          summary.push('Ночной коэффициент применён');
        }
        await ctx.reply(summary.join('\n'), Markup.inlineKeyboard([
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
          from_entrance: s.fromEntrance ?? null,
          from_floor: s.fromFloor ?? null,
          from_flat: s.fromFlat ?? null,
          from_intercom: s.fromIntercom ?? null,
          to_entrance: s.toEntrance ?? null,
          to_floor: s.toFloor ?? null,
          to_flat: s.toFlat ?? null,
          to_intercom: s.toIntercom ?? null,
        });

        const settings = getSettings();
        if (settings.drivers_channel_id) {
          const timePart = s.time === 'Сейчас' ? 'сейчас' : `к ${s.time}`;
          const header = `Алматы • ${typeLabels[order.type as OrderType]} • ${
            s.size || 'M'
          } • ${timePart}`;
          const card = [
            `#${order.id}`,
            header,
            `Откуда: ${fromAddr}`,
            `Куда: ${toAddr}`,
            `Расстояние: ${dist.toFixed(1)} км`,
            `ETA: ~${eta} мин`,
            `Оплата: ${s.payment}`,
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

  bot.action(/order:addr_extra:(.+)/, async (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s) return;
    const field = ctx.match[1] as 'entrance' | 'floor' | 'flat' | 'intercom';
    const msgId = (ctx.callbackQuery?.message as any)?.message_id;
    let target: 'from' | 'to' | null = null;
    if (msgId === s.fromMsgId) target = 'from';
    else if (msgId === s.toMsgId) target = 'to';
    if (!target) return;
    s.addrExtra = { target, field };
    const labels: Record<typeof field, string> = {
      entrance: 'подъезд',
      floor: 'этаж',
      flat: 'квартиру',
      intercom: 'домофон',
    } as any;
    await ctx.answerCbQuery();
    await ctx.reply(`Введите ${labels[field]}`);
  });

  bot.action('dims:done', async (ctx) => {
    const s = sessions.get(ctx.from!.id);
    if (!s || s.step !== 5) return;
    if (!s.size) {
      await ctx.answerCbQuery('Выберите габариты');
      return;
    }
    s.step = 6;
    if (s.msgId) {
      await ctx.telegram.deleteMessage(ctx.chat!.id, s.msgId).catch(() => {});
    }
    const msg = await ctx.reply(
      'Оплата? (наличные/карта/получатель платит)',
      Markup.keyboard(['Наличные', 'Карта', 'Получатель платит'])
        .oneTime()
        .resize()
    );
    s.msgId = msg.message_id;
    await ctx.answerCbQuery();
  });

  bot.action('order:2gis', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(twoGisHelp);
  });
}
