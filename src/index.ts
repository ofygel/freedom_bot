import 'dotenv/config';
import { Telegraf } from 'telegraf';
import registerStart from './commands/start';
import { registerBindingCommands } from './commands/bindings';
import registerOrderCommands from './commands/order';
import { setOrdersBot } from './services/orders';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN in environment');
  process.exit(1);
}

const bot = new Telegraf(token);

// expose bot instance to services that need to send messages
setOrdersBot(bot);

// commands
registerStart(bot);
registerBindingCommands(bot);
registerOrderCommands(bot);

// health
bot.command('ping', ctx => ctx.reply('pong'));

// launch
bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
