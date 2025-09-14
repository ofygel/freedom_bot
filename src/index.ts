import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import startCommand from './commands/start.js';
import { handleBindingCommands, pingBindingsCommand } from './commands/bindings.js';

dotenv.config();

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const bot = new Telegraf(token);

startCommand(bot);
handleBindingCommands(bot);
pingBindingsCommand(bot);

bot.launch().then(() => {
  console.log('Bot started');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
