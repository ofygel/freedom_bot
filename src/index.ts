import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import startCommand from './commands/start.js';
import { handleBindingCommands, pingBindingsCommand } from './commands/bindings.js';
import orderCommands from './commands/order.js';
<<<<<<< HEAD
<<<<<<< HEAD
<<<<<<< HEAD
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
=======
import supportCommands from './commands/support.js';
import chatCommands from './commands/chat.js';
import orderStatusCommands from './commands/orderStatus.js';
import { setOrdersBot } from './services/orders.js';
>>>>>>> 270ffc9 (feat: add support tickets and proxy chat)
=======
import adminCommands from './commands/admin.js';
>>>>>>> 32bd694 (feat: add tariff settings and admin controls)
=======
>>>>>>> 5154931 (fix: resolve merge conflicts and simplify build)

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(token);

setOrdersBot(bot);

startCommand(bot);
handleBindingCommands(bot);
pingBindingsCommand(bot);
orderCommands(bot);

bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
