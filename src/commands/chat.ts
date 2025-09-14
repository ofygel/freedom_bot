import { Telegraf } from 'telegraf';
import { getOrder } from '../services/orders.js';
import { sendProxyMessage } from '../services/chat.js';

export default function chatCommands(bot: Telegraf) {
  bot.command('msg', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply('Usage: /msg <orderId> <text>');
    }
    const orderId = Number(args[0]);
    if (isNaN(orderId)) {
      return ctx.reply('Неверный номер заказа');
    }
    const text = args.slice(1).join(' ');
    const order = getOrder(orderId);
    if (!order) {
      return ctx.reply('Заказ не найден');
    }
    const fromId = ctx.from!.id;
    let toId: number | undefined;
    if (order.client_id === fromId && order.courier_id) {
      toId = order.courier_id;
    } else if (order.courier_id === fromId) {
      toId = order.client_id;
    }
    if (!toId) {
      return ctx.reply('Нет собеседника для этого заказа');
    }
    await sendProxyMessage(bot, orderId, fromId, toId, text);
    await ctx.reply('Отправлено');
  });
}
