import { Telegraf } from 'telegraf';
import { updateOrderStatus } from '../services/orders.js';
import { cleanupOldChats } from '../services/chat.js';

export default function orderStatusCommands(bot: Telegraf) {
  bot.command('order_status', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply('Usage: /order_status <id> <new|assigned|delivered>');
    }
    const id = Number(args[0]);
    const statusArg = args[1];
    const allowedStatuses = ['new', 'assigned', 'delivered'] as const;
    if (!allowedStatuses.includes(statusArg as any)) {
      return ctx.reply('Неверный статус. Используйте: new, assigned или delivered');
    }
    const statusMap = { new: 'open', assigned: 'assigned', delivered: 'delivered' } as const;
    const status = statusMap[statusArg as keyof typeof statusMap];
    const courierId = statusArg === 'assigned' ? ctx.from!.id : undefined;
    const order = updateOrderStatus(id, status, courierId);
    if (!order) return ctx.reply('Order not found');
    await ctx.reply('Статус обновлён');
    await ctx.telegram.sendMessage(order.customer_id, `Статус заказа #${order.id}: ${order.status}`);
    if (order.courier_id) {
      await ctx.telegram.sendMessage(order.courier_id, `Статус заказа #${order.id}: ${order.status}`);
    }
    if (status === 'delivered') {
      cleanupOldChats();
    }
  });
}
