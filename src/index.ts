import 'dotenv/config';
import { Telegraf } from 'telegraf';
import registerStart from './commands/start';
import { registerBindingCommands } from './commands/bindings';
import registerOrderCommands from './commands/order';
import driverCommands from './commands/driver';
import supportCommands from './commands/support';
import chatCommands from './commands/chat';
import orderStatusCommands from './commands/orderStatus';
import profileCommands from './commands/profile';
import adminCommands from './commands/admin';
import { setOrdersBot } from './services/orders';

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
driverCommands(bot);
supportCommands(bot);
chatCommands(bot);
orderStatusCommands(bot);
profileCommands(bot);
adminCommands(bot);

bot.command('ping', (ctx) => ctx.reply('pong'));

bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
