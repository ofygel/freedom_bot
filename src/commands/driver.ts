// @ts-nocheck
import { Telegraf, Markup, Context } from 'telegraf';
import {
  assignOrder,
  reserveOrder,
  getCourierActiveOrder,
  getOrder,
  updateOrderStatus,
  addPickupProof,
  addDeliveryProof,
  updateOrder,
  openDispute,
  addDisputeMessage,
} from '../services/orders';
import type { OrderStatus } from '../services/orders';
import {
  toggleCourierOnline,
  isCourierOnline,
  hideOrderForCourier,
  isOrderHiddenForCourier
} from '../services/courierState';
import { getSettings } from '../services/settings';
import { routeToDeeplink } from '../utils/twoGis';
import { reverseGeocode } from '../utils/geocode';
import { rateLimit } from '../utils/rateLimiter';

interface ProofState {
  orderId: number;
  type: 'pickup' | 'delivery';
}

const proofPending = new Map<number, ProofState>();
const disputePending = new Map<number, number>();
const ACTION_LIMIT = 5;
const ACTION_INTERVAL = 60 * 1000;

export default function driverCommands(bot: Telegraf) {
  bot.command('assign', (ctx) => {
    if (ctx.chat?.type !== 'private') return;
    const parts = ctx.message.text.split(' ');
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Укажите ID заказа.');
    if (!isCourierOnline(ctx.from!.id)) {
      return ctx.reply('Сначала включите режим Онлайн.');
    }
    if (isOrderHiddenForCourier(ctx.from!.id, id)) {
      return ctx.reply('Этот заказ временно скрыт.');
    }
    const order = assignOrder(id, ctx.from!.id);
    if (!order) return ctx.reply('Не удалось назначить заказ.');
    ctx.reply(
      `Заказ #${order.id} назначен.`,
      Markup.keyboard([
        ['Еду к отправителю'],
        ['Скрыть на 1 час'],
        ['Открыть спор']
      ]).resize()
    );
  });

  bot.action(/reserve:(\d+)/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const uid = ctx.from!.id;
    if (!rateLimit(`reserve:${uid}`, ACTION_LIMIT, ACTION_INTERVAL)) {
      await ctx.answerCbQuery('Слишком часто');
      return;
    }
    if (!isCourierOnline(uid)) {
      await ctx.answerCbQuery('Сначала включите режим Онлайн.');
      return;
    }
    if (isOrderHiddenForCourier(uid, id)) {
      await ctx.answerCbQuery('Заказ скрыт.');
      return;
    }
    const order = reserveOrder(id, uid);
    if (!order) {
      await ctx.answerCbQuery('Не удалось зарезервировать.');
      return;
    }
    await ctx.answerCbQuery('Зарезервировано');
    const text = `${(ctx.callbackQuery.message as any).text}\nЗанято`;
    await ctx.editMessageText(text).catch(() => {});
    await ctx.editMessageReplyMarkup(
      Markup.inlineKeyboard([
        [
          Markup.button.url('Маршрут', routeToDeeplink(order.from, order.to)),
          Markup.button.url(
            'До точки B',
            `https://2gis.kz/almaty?m=${order.to.lon},${order.to.lat}`
          ),
        ],
        [Markup.button.callback('Детали', `details:${order.id}`)],
      ]).reply_markup
    ).catch(() => {});
    await ctx.telegram.sendMessage(
      uid,
      `Заказ #${order.id} зарезервирован. Отправьте /assign ${order.id} в личные сообщения боту.`
    );
  });

  bot.action(/details:(\d+)/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const order = getOrder(id);
    if (!order) {
      await ctx.answerCbQuery('Не найдено');
      return;
    }
    const fromAddr = await reverseGeocode(order.from);
    const toAddr = await reverseGeocode(order.to);
    const pay =
      order.pay_type === 'card'
        ? 'Карта'
        : order.pay_type === 'receiver'
        ? 'Получатель платит'
        : 'Наличные';
    const msg = [
      `#${order.id}`,
      `Откуда: ${fromAddr}`,
      `Куда: ${toAddr}`,
      `Время: ${order.time}`,
      `Оплата: ${pay}`,
      `Габариты: ${order.size}`,
      `Опции: ${order.options || 'нет'}`,
      `Комментарий: ${order.comment || ''}`,
      `Цена: ~${order.price} ₸`,
    ].join('\n');
    await ctx.telegram.sendMessage(
      ctx.from!.id,
      msg,
      Markup.inlineKeyboard([
        [
          Markup.button.url('Маршрут', routeToDeeplink(order.from, order.to)),
          Markup.button.url(
            'До точки B',
            `https://2gis.kz/almaty?m=${order.to.lon},${order.to.lat}`
          ),
        ],
      ])
    );
    await ctx.answerCbQuery();
  });

  bot.action(/hide:(\d+)/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const uid = ctx.from!.id;
    if (!rateLimit(`hide:${uid}`, ACTION_LIMIT, ACTION_INTERVAL)) {
      await ctx.answerCbQuery('Слишком часто');
      return;
    }
    hideOrderForCourier(uid, id);
    await ctx.answerCbQuery('Скрыто на 1 час');
  });

  bot.hears('Еду к отправителю', (ctx) =>
    handleTransition(ctx, 'assigned', 'going_to_pickup', 'У отправителя')
  );
  bot.hears('У отправителя', (ctx) =>
    handleTransition(ctx, 'going_to_pickup', 'at_pickup', 'Забрал')
  );
  bot.hears('Онлайн/Оффлайн', (ctx) => {
    const online = toggleCourierOnline(ctx.from!.id);
    ctx.reply(online ? 'Вы в сети.' : 'Вы оффлайн.');
  });

  bot.hears('Скрыть на 1 час', (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    updateOrderStatus(order.id, 'open');
    hideOrderForCourier(ctx.from!.id, order.id);
    ctx.reply('Заказ скрыт на 1 час.', Markup.removeKeyboard());
  });

  bot.hears('Забрал', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'at_pickup')
      return ctx.reply('Неверный этап.');
    proofPending.set(ctx.from!.id, { orderId: order.id, type: 'pickup' });
    await ctx.reply('Введите код от отправителя или отправьте фото.');
  });

  bot.hears('В пути', (ctx) =>
    handleTransition(ctx, 'picked', 'going_to_dropoff', 'У получателя')
  );
  bot.hears('У получателя', (ctx) =>
    handleTransition(ctx, 'going_to_dropoff', 'at_dropoff', 'Доставлено')
  );

  bot.hears('Доставлено', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'at_dropoff')
      return ctx.reply('Неверный этап.');
    proofPending.set(ctx.from!.id, { orderId: order.id, type: 'delivery' });
    await ctx.reply('Введите код от получателя или отправьте фото.');
    if (order.pay_type === 'receiver') {
      await ctx.reply('Инвойс на оплату будет отправлен получателю.');
    }
  });

  bot.hears('Открыть спор', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    openDispute(order.id);
    disputePending.set(ctx.from!.id, order.id);
    await ctx.reply('Опишите проблему для модераторов.');
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const proof = proofPending.get(uid);
    if (proof) {
      const order = getOrder(proof.orderId);
      if (!order) {
        proofPending.delete(uid);
        return;
      }
      const code = ctx.message.text.trim();
      if (proof.type === 'pickup') {
        if (code !== order.pickup_code) {
          await ctx.reply('Неверный код. Попробуйте снова или отправьте фото.');
          return;
        }
        addPickupProof(proof.orderId, code);
        updateOrderStatus(proof.orderId, 'picked');
        await ctx.reply(
          'Подтверждение получено.',
          Markup.keyboard([['В пути'], ['Открыть спор']]).resize()
        );
      } else {
        if (code !== order.dropoff_code) {
          await ctx.reply('Неверный код. Попробуйте снова или отправьте фото.');
          return;
        }
        addDeliveryProof(proof.orderId, code);
        const ord = getCourierActiveOrder(uid);
        if (ord && ord.pay_type === 'receiver') {
          updateOrderStatus(proof.orderId, 'awaiting_confirm');
          if (process.env.PROVIDER_TOKEN) {
            await ctx.telegram.sendInvoice(
              ord.customer_id,
              'Оплата доставки',
              `Заказ #${ord.id}`,
              `order-${ord.id}`,
              process.env.PROVIDER_TOKEN,
              '',
              'KZT',
              [{ label: 'Доставка', amount: Math.round((ord.price || 0) * 100) }]
            );
          }
          await ctx.reply(
            'Ожидайте оплату от получателя.',
            Markup.keyboard([['Оплату получил'], ['Открыть спор']]).resize()
          );
        } else if (ord && ord.pay_type !== 'cash') {
          updateOrderStatus(proof.orderId, 'delivered');
          await ctx.reply(
            'Ожидайте оплату от клиента.',
            Markup.keyboard([['Оплату получил'], ['Открыть спор']]).resize()
          );
        } else {
          updateOrderStatus(proof.orderId, 'closed');
          await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
        }
      }
      proofPending.delete(uid);
      return;
    }
    const dispute = disputePending.get(uid);
    if (dispute) {
      const settings = getSettings();
      addDisputeMessage(dispute, 'courier', ctx.message.text);
      if (settings.moderators_channel_id) {
        const text = `Спор по заказу #${dispute}\nОт: ${uid}\n${ctx.message.text}`;
        await ctx.telegram.sendMessage(settings.moderators_channel_id, text);
      }
      await ctx.reply('Спор открыт, модераторы свяжутся.');
      disputePending.delete(uid);
    }
  });

  bot.hears('Оплату получил', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) {
      return ctx.reply('Неверный этап.');
    }
    if (
      (order.pay_type === 'receiver' && order.status !== 'awaiting_confirm') ||
      (order.pay_type !== 'receiver' && order.status !== 'delivered')
    ) {
      return ctx.reply('Неверный этап.');
    }
    updateOrder(order.id, { payment_status: 'paid' });
    updateOrderStatus(order.id, 'closed');
    await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
  });

  bot.on('photo', async (ctx) => {
    const uid = ctx.from!.id;
    const proof = proofPending.get(uid);
    if (!proof) return;
    const photos = (ctx.message as any).photo as { file_id: string }[] | undefined;
    if (!photos || photos.length === 0) return;
    const last = photos[photos.length - 1];
    if (!last) return;
    const fileId = last.file_id;
    if (proof.type === 'pickup') {
      addPickupProof(proof.orderId, fileId);
      updateOrderStatus(proof.orderId, 'picked');
      await ctx.reply(
        'Фото получено.',
        Markup.keyboard([['В пути'], ['Открыть спор']]).resize()
      );
    } else {
      addDeliveryProof(proof.orderId, fileId);
      const ord = getCourierActiveOrder(uid);
      if (ord && ord.pay_type === 'receiver') {
        updateOrderStatus(proof.orderId, 'awaiting_confirm');
        if (process.env.PROVIDER_TOKEN) {
          await ctx.telegram.sendInvoice(
            ord.customer_id,
            'Оплата доставки',
            `Заказ #${ord.id}`,
            `order-${ord.id}`,
            process.env.PROVIDER_TOKEN,
            '',
            'KZT',
            [{ label: 'Доставка', amount: Math.round((ord.price || 0) * 100) }]
          );
        }
        await ctx.reply(
          'Ожидайте оплату от получателя.',
          Markup.keyboard([['Оплату получил'], ['Открыть спор']]).resize()
        );
      } else if (ord && ord.pay_type !== 'cash') {
        updateOrderStatus(proof.orderId, 'delivered');
        await ctx.reply(
          'Ожидайте оплату от клиента.',
          Markup.keyboard([['Оплату получил'], ['Открыть спор']]).resize()
        );
      } else {
        updateOrderStatus(proof.orderId, 'closed');
        await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
      }
    }
    proofPending.delete(uid);
  });
}

function handleTransition(
  ctx: Context,
  fromStatus: OrderStatus,
  toStatus: OrderStatus,
  nextButton: string
) {
  const order = getCourierActiveOrder(ctx.from!.id);
  if (!order || order.status !== fromStatus) {
    ctx.reply('Неверный этап.');
    return;
  }
  updateOrderStatus(order.id, toStatus);
  ctx.reply(
    'Статус обновлён.',
    Markup.keyboard([[nextButton], ['Открыть спор']]).resize()
  );
  if (toStatus === 'at_dropoff' && order.pay_type === 'receiver') {
    ctx.reply('Передайте получателю, что оплата необходима при получении.');
  }
}
