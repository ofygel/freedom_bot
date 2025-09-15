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
  logEvent,
  setOrdersBot,
  sendInvoiceToReceiver,
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
import { formatAddress } from '../utils/address';
import { rateLimit } from '../utils/rateLimiter';
import { createOrderChat, markOrderChatDelivered } from '../services/chat';

interface ProofState {
  orderId: number;
  type: 'pickup' | 'delivery';
}

const proofPending = new Map<number, ProofState>();
const disputePending = new Map<number, number>();
const ACTION_LIMIT = 5;
const ACTION_INTERVAL = 60 * 1000;

function buildOrderKeyboard(status: OrderStatus) {
  const buttons: string[][] = [];
  switch (status) {
    case 'assigned':
      buttons.push(['Еду к отправителю'], ['Скрыть на 1 час']);
      break;
    case 'going_to_pickup':
      buttons.push(['У отправителя']);
      break;
    case 'at_pickup':
      buttons.push(['Забрал']);
      break;
    case 'picked':
      buttons.push(['В пути']);
      break;
    case 'going_to_dropoff':
      buttons.push(['У получателя']);
      break;
    case 'at_dropoff':
      buttons.push(['Доставлено']);
      break;
    case 'awaiting_confirm':
    case 'delivered':
      buttons.push(['Оплату получил'], ['Поступление проверил']);
      break;
  }
  buttons.push(
    ['Проблема с оплатой'],
    ['Клиента нет на месте'],
    ['Изменение адреса'],
    ['Открыть спор']
  );
  return Markup.keyboard(buttons).resize();
}

export default function driverCommands(bot: Telegraf) {
  setOrdersBot(bot as any);
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
    createOrderChat(order.id, order.customer_id, order.courier_id!);
    ctx.reply(
      `Заказ #${order.id} назначен.`,
      buildOrderKeyboard('assigned')
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
      `Заказ #${order.id} зарезервирован.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Подтвердить старт', `assign:${order.id}`)],
      ])
    );
  });

  bot.action(/assign:(\d+)/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const uid = ctx.from!.id;
    if (!isCourierOnline(uid)) {
      await ctx.answerCbQuery('Сначала включите режим Онлайн.');
      return;
    }
    if (isOrderHiddenForCourier(uid, id)) {
      await ctx.answerCbQuery('Заказ скрыт.');
      return;
    }
    const order = assignOrder(id, uid);
    if (!order) {
      await ctx.answerCbQuery('Не удалось назначить.');
      return;
    }
    createOrderChat(order.id, order.customer_id, order.courier_id!);
    await ctx.answerCbQuery('Назначено');
    await ctx.editMessageReplyMarkup(undefined).catch(() => {});
    await ctx.editMessageText(`Заказ #${order.id} назначен.`).catch(() => {});
    await ctx.reply(
      `Заказ #${order.id} назначен.`,
      buildOrderKeyboard('assigned')
    );
  });

  bot.action(/details:(\d+)/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const order = getOrder(id);
    if (!order) {
      await ctx.answerCbQuery('Не найдено');
      return;
    }
    const fromAddr = formatAddress(await reverseGeocode(order.from), {
      entrance: order.from_entrance || undefined,
      floor: order.from_floor || undefined,
      flat: order.from_flat || undefined,
      intercom: order.from_intercom || undefined,
    });
    const toAddr = formatAddress(await reverseGeocode(order.to), {
      entrance: order.to_entrance || undefined,
      floor: order.to_floor || undefined,
      flat: order.to_flat || undefined,
      intercom: order.to_intercom || undefined,
    });
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
    handleTransition(ctx, 'assigned', 'going_to_pickup')
  );
  bot.hears('У отправителя', (ctx) =>
    handleTransition(ctx, 'going_to_pickup', 'at_pickup')
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
    handleTransition(ctx, 'picked', 'going_to_dropoff')
  );
  bot.hears('У получателя', (ctx) =>
    handleTransition(ctx, 'going_to_dropoff', 'at_dropoff')
  );

  bot.hears('Доставлено', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'at_dropoff')
      return ctx.reply('Неверный этап.');
    if (order.pay_type === 'receiver' && order.payment_status !== 'paid') {
      openDispute(order.id);
      if (process.env.PROVIDER_TOKEN) {
        await ctx.telegram.sendMessage(
          order.customer_id,
          `Пожалуйста, оплатите доставку по заказу #${order.id}.`
        );
      }
      await ctx.reply('Оплата не поступила. Спор открыт.');
    }
    proofPending.set(ctx.from!.id, { orderId: order.id, type: 'delivery' });
    await ctx.reply('Введите код от получателя или отправьте фото.');
  });

  bot.hears('Открыть спор', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    openDispute(order.id);
    disputePending.set(ctx.from!.id, order.id);
    await ctx.reply('Опишите проблему для модераторов.');
  });

  bot.hears('Проблема с оплатой', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    logEvent(order.id, 'payment_issue', ctx.from!.id, {});
    const settings = getSettings();
    const text = `Проблема с оплатой по заказу #${order.id}`;
    if (settings.moderators_channel_id) {
      await ctx.telegram.sendMessage(settings.moderators_channel_id, text);
    }
    await ctx.telegram.sendMessage(order.customer_id, text).catch(() => {});
    await ctx.reply('Уведомления отправлены.', buildOrderKeyboard(order.status));
  });

  bot.hears('Клиента нет на месте', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    logEvent(order.id, 'client_absent', ctx.from!.id, {});
    const settings = getSettings();
    const text = `Курьер не нашёл клиента по заказу #${order.id}`;
    if (settings.moderators_channel_id) {
      await ctx.telegram.sendMessage(settings.moderators_channel_id, text);
    }
    await ctx.telegram.sendMessage(order.customer_id, text).catch(() => {});
    await ctx.reply('Уведомления отправлены.', buildOrderKeyboard(order.status));
  });

  bot.hears('Изменение адреса', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    logEvent(order.id, 'address_change_requested', ctx.from!.id, {});
    openDispute(order.id);
    const settings = getSettings();
    const text = `Запрос на изменение адреса по заказу #${order.id}`;
    if (settings.moderators_channel_id) {
      await ctx.telegram.sendMessage(settings.moderators_channel_id, text);
    }
    await ctx.telegram.sendMessage(order.customer_id, text).catch(() => {});
    await ctx.reply('Запрос отправлен.', buildOrderKeyboard(order.status));
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
          buildOrderKeyboard('picked')
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
          await ctx.reply(
            'Ожидайте оплату от получателя.',
            buildOrderKeyboard('awaiting_confirm')
          );
        } else if (ord && ord.pay_type !== 'cash') {
          updateOrderStatus(proof.orderId, 'delivered');
          markOrderChatDelivered(proof.orderId);
          await ctx.reply(
            'Ожидайте оплату от клиента.',
            buildOrderKeyboard('delivered')
          );
        } else {
          updateOrderStatus(proof.orderId, 'closed');
          markOrderChatDelivered(proof.orderId);
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
    markOrderChatDelivered(order.id);
    await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
  });

  bot.hears('Поступление проверил', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'awaiting_confirm') {
      return ctx.reply('Неверный этап.');
    }
    openDispute(order.id);
    await ctx.reply('Спор открыт, модераторы свяжутся.', buildOrderKeyboard('awaiting_confirm'));
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
        buildOrderKeyboard('picked')
      );
    } else {
      addDeliveryProof(proof.orderId, fileId);
      const ord = getCourierActiveOrder(uid);
      if (ord && ord.pay_type === 'receiver') {
        updateOrderStatus(proof.orderId, 'awaiting_confirm');
        await ctx.reply(
          'Ожидайте оплату от получателя.',
          buildOrderKeyboard('awaiting_confirm')
        );
      } else if (ord && ord.pay_type !== 'cash') {
        updateOrderStatus(proof.orderId, 'delivered');
        markOrderChatDelivered(proof.orderId);
        await ctx.reply(
          'Ожидайте оплату от клиента.',
          buildOrderKeyboard('delivered')
        );
      } else {
        updateOrderStatus(proof.orderId, 'closed');
        markOrderChatDelivered(proof.orderId);
        await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
      }
    }
    proofPending.delete(uid);
  });
}

function handleTransition(
  ctx: Context,
  fromStatus: OrderStatus,
  toStatus: OrderStatus
) {
  const order = getCourierActiveOrder(ctx.from!.id);
  if (!order || order.status !== fromStatus) {
    ctx.reply('Неверный этап.');
    return;
  }
  updateOrderStatus(order.id, toStatus);
  ctx.reply('Статус обновлён.', buildOrderKeyboard(toStatus));
  if (order.pay_type === 'receiver') {
    if (toStatus === 'going_to_dropoff') {
      sendInvoiceToReceiver(order);
      ctx.reply('Ожидайте оплату от получателя.');
    } else if (toStatus === 'at_dropoff') {
      ctx.reply('Передайте получателю, что оплата необходима при получении.');
    }
  }
}
