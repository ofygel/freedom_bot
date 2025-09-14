import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import startCommand from './commands/start.js';
import { handleBindingCommands, pingBindingsCommand } from './commands/bindings.js';
import orderCommands from './commands/order.js';
<<<<<<< HEAD
<<<<<<< HEAD
import { releaseExpiredReservations } from './services/orders.js';
=======
import driverCommands from './commands/driver.js';
import { checkOrderTimeouts } from './services/orders.js';
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)
import { getSettings } from './services/settings.js';
=======
import profileCommands from './commands/profile.js';
>>>>>>> 8bdc958 (feat: add courier verification)

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
<<<<<<< HEAD
driverCommands(bot);
=======
profileCommands(bot);
>>>>>>> 8bdc958 (feat: add courier verification)

bot.launch().then(() => {
  console.log('Bot started');
});

<<<<<<< HEAD
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
=======
setInterval(() => {
  checkOrderTimeouts(30 * 60 * 1000, (order) => {
    const settings = getSettings();
    if (settings.drivers_channel_id) {
      bot.telegram.sendMessage(
        settings.drivers_channel_id,
        `Заказ #${order.id} возвращён в ленту из-за отсутствия прогресса.`
      );
    }
  });
}, 60 * 1000);
>>>>>>> b73ce5b (feat: add courier workflow and dispute handling)

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
