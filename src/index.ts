import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import startCommand from './commands/start.js';
import { handleBindingCommands, pingBindingsCommand } from './commands/bindings.js';
import orderCommands from './commands/order.js';
import { releaseExpiredReservations } from './services/orders.js';
import { getSettings } from './services/settings.js';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(token);

startCommand(bot);
handleBindingCommands(bot);
pingBindingsCommand(bot);
orderCommands(bot);

bot.launch().then(() => {
  console.log('Bot started');
});

setInterval(async () => {
  const settings = getSettings();
  if (!settings.drivers_channel_id) return;
  const expired = releaseExpiredReservations();
  for (const order of expired) {
    if (!order.message_id) continue;
    const text = `Новый заказ #${order.id}\nОткуда: ${order.from.addr}\nКуда: ${order.to.addr}`;
    try {
      await bot.telegram.editMessageText(
        settings.drivers_channel_id,
        order.message_id,
        undefined,
        text,
        Markup.inlineKeyboard([
          [Markup.button.callback('Принять', `accept_${order.id}`)]
        ])
      );
    } catch (e) {
      console.error('edit fail', e);
    }
  }
}, 5000);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
