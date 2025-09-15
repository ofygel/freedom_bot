import 'dotenv/config';
import { Telegraf } from 'telegraf';
import registerStart from './commands/start';
import { registerBindingCommands } from './commands/bindings';
import registerOrderCommands from './commands/order';
import courierCommands from './commands/courier';
import supportCommands from './commands/support';
import chatCommands from './commands/chat';
import orderStatusCommands from './commands/orderStatus';
import profileCommands from './commands/profile';
import adminCommands from './commands/admin';
import { setOrdersBot, expireReservations, expireMovementTimers, expireAwaitingConfirm } from './services/orders';
import { rollupDailyMetrics } from './services/metrics';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in environment');
  process.exit(1);
}

const bot = new Telegraf(token);
setOrdersBot(bot);

registerStart(bot);
registerBindingCommands(bot);
registerOrderCommands(bot);
courierCommands(bot);
supportCommands(bot);
chatCommands(bot);
orderStatusCommands(bot);
profileCommands(bot);
adminCommands(bot);

setInterval(expireReservations, 30_000);
setInterval(expireMovementTimers, 30_000);
setInterval(expireAwaitingConfirm, 30_000);

rollupDailyMetrics();
setInterval(rollupDailyMetrics, 24 * 60 * 60 * 1000);

bot.command('ping', (ctx) => ctx.reply('pong'));

bot.launch()
  .then(() => console.log('Bot started'))
  .catch((err) => {
    if (err.response?.error_code === 409) {
      console.error('Bot launch failed: another instance is already running.', err);
    } else {
      console.error('Bot launch failed', err);
    }
    process.exit(1);
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
