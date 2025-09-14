import { Telegraf, Markup, Context } from 'telegraf';
import {
  assignOrder,
  getCourierActiveOrder,
  updateOrderStatus,
  addPickupProof,
  addDeliveryProof
} from '../services/orders.js';
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
    const order = assignOrder(id, ctx.from!.id);
    if (!order) return ctx.reply('Не удалось назначить заказ.');
    ctx.reply(
      `Заказ #${order.id} назначен.`,
      Markup.keyboard([['Еду к отправителю'], ['Открыть спор']]).resize()
    );
  });

  bot.hears('Еду к отправителю', (ctx) => handleTransition(ctx, 'assigned', 'heading_to_sender', 'У отправителя'));
  bot.hears('У отправителя', (ctx) => handleTransition(ctx, 'heading_to_sender', 'at_sender', 'Забрал'));

  bot.hears('Забрал', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'at_sender') return ctx.reply('Неверный этап.');
    proofPending.set(ctx.from!.id, { orderId: order.id, type: 'pickup' });
    await ctx.reply('Введите код от отправителя или отправьте фото.');
  });

  bot.hears('В пути', (ctx) => handleTransition(ctx, 'picked_up', 'en_route', 'У получателя'));
  bot.hears('У получателя', (ctx) => handleTransition(ctx, 'en_route', 'at_recipient', 'Доставлено'));

  bot.hears('Доставлено', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order || order.status !== 'at_recipient') return ctx.reply('Неверный этап.');
    proofPending.set(ctx.from!.id, { orderId: order.id, type: 'delivery' });
    await ctx.reply('Введите код от получателя или отправьте фото.');
  });

  bot.hears('Открыть спор', async (ctx) => {
    const order = getCourierActiveOrder(ctx.from!.id);
    if (!order) return ctx.reply('Нет активного заказа.');
    updateOrderStatus(order.id, 'dispute_open');
    disputePending.set(ctx.from!.id, order.id);
    await ctx.reply('Опишите проблему для модераторов.');
  });

  bot.on('text', async (ctx) => {
    const uid = ctx.from!.id;
    const proof = proofPending.get(uid);
    if (proof) {
      if (proof.type === 'pickup') {
        addPickupProof(proof.orderId, ctx.message.text);
        updateOrderStatus(proof.orderId, 'picked_up');
        await ctx.reply(
          'Подтверждение получено.',
          Markup.keyboard([['В пути'], ['Открыть спор']]).resize()
        );
      } else {
        addDeliveryProof(proof.orderId, ctx.message.text);
        updateOrderStatus(proof.orderId, 'delivered');
        updateOrderStatus(proof.orderId, 'closed');
        await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
      }
      proofPending.delete(uid);
      return;
    }
    const dispute = disputePending.get(uid);
    if (dispute) {
      const settings = getSettings();
      if (settings.moderators_channel_id) {
        const text = `Спор по заказу #${dispute}\nОт: ${uid}\n${ctx.message.text}`;
        await ctx.telegram.sendMessage(settings.moderators_channel_id, text);
      }
      await ctx.reply('Спор открыт, модераторы свяжутся.');
      disputePending.delete(uid);
    }
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
      updateOrderStatus(proof.orderId, 'picked_up');
      await ctx.reply(
        'Фото получено.',
        Markup.keyboard([['В пути'], ['Открыть спор']]).resize()
      );
    } else {
      addDeliveryProof(proof.orderId, fileId);
      updateOrderStatus(proof.orderId, 'delivered');
      updateOrderStatus(proof.orderId, 'closed');
      await ctx.reply('Заказ завершён.', Markup.removeKeyboard());
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
  ctx.reply(
    'Статус обновлён.',
    Markup.keyboard([[nextButton], ['Открыть спор']]).resize()
  );
}
