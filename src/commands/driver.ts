import { Telegraf, Markup, Context } from 'telegraf';
import {
  assignOrder,
  getCourierActiveOrder,
  getOrder,
  updateOrderStatus,
  addPickupProof,
  addDeliveryProof,
  updateOrder
  openDispute,
  addDisputeMessage,
} from '../services/orders.js';
import {
  toggleCourierOnline,
  isCourierOnline,
  hideOrderForCourier,
  isOrderHiddenForCourier
} from '../services/courierState.js';
import { getSettings } from '../services/settings.js';

interface ProofState {
  orderId: number;
  type: 'pickup' | 'delivery';
}

const proofPending = new Map<number, ProofState>();
const disputePending = new Map<number, number>();

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
    updateOrderStatus(order.id, 'new');
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
      await ctx.reply('Напомните получателю об оплате заказа.');
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
        updateOrderStatus(proof.orderId, 'delivered');
        const ord = getCourierActiveOrder(uid);
        if (ord && ord.pay_type !== 'cash') {
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
    if (!order || order.status !== 'delivered') {
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
      updateOrderStatus(proof.orderId, 'delivered');
      const ord = getCourierActiveOrder(uid);
      if (ord && ord.pay_type !== 'cash') {
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
  fromStatus: string,
  toStatus: any,
  nextButton: string
) {
  const order = getCourierActiveOrder(ctx.from!.id);
  if (!order || order.status !== fromStatus) {
    ctx.reply('Неверный этап.');
    return;
  }
  updateOrderStatus(order.id, toStatus);
  const extra = [nextButton];
  ctx.reply(
    'Статус обновлён.',
    Markup.keyboard([extra, ['Открыть спор']]).resize()
  );
  if (toStatus === 'at_dropoff' && order.pay_type === 'receiver') {
    ctx.reply('Передайте получателю, что оплата необходима при получении.');
  }
}
