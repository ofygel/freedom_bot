// @ts-nocheck
import { Telegraf } from 'telegraf';
import { getOrder } from '../services/orders';
import {
  sendProxyMessage,
  getActiveChatByUser,
  cleanupOldChats,
} from '../services/chat';

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
    if (order.customer_id === fromId && order.courier_id) {
      toId = order.courier_id;
    } else if (order.courier_id === fromId) {
      toId = order.customer_id;
    }
    if (!toId) {
      return ctx.reply('Собеседник пока не подключен к чату');
    }
    await sendProxyMessage(bot, orderId, fromId, toId, text);
    await ctx.reply('Отправлено');
  });

  bot.on('text', async (ctx, next) => {
    if (ctx.message.text.startsWith('/')) return next();
    const chat = getActiveChatByUser(ctx.from!.id);
    if (!chat) return next();
    const fromId = ctx.from!.id;
    let toId: number | undefined;
    if (chat.customer_id === fromId) {
      toId = chat.courier_id;
    } else if (chat.courier_id === fromId) {
      toId = chat.customer_id;
    }
    if (!toId) {
      return ctx.reply('Собеседник пока не подключен к чату');
    }
    await sendProxyMessage(bot, chat.order_id, fromId, toId, ctx.message.text);
  });

  setInterval(cleanupOldChats, 60 * 60 * 1000);
}
