import 'dotenv/config';
import { Telegraf, TelegramError } from 'telegraf';
import registerStart from './commands/start';
import { registerBindingCommands } from './commands/bindings';
import registerOrderCommands from './commands/order';
import courierCommands from './commands/courier';
import supportCommands from './commands/support';
import chatCommands from './commands/chat';
import orderStatusCommands from './commands/orderStatus';
import profileCommands from './commands/profile';
import adminCommands from './commands/admin';
import {
  setOrdersBot,
  expireReservations,
  expireMovementTimers,
  expireAwaitingConfirm,
} from './services/orders';
import { rollupDailyMetrics } from './services/metrics';
import { resetTelegramSession } from './utils/telegramSession';

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

setInterval(() => {
  expireReservations().catch(err => console.error('Failed to expire reservations', err));
}, 30_000);
setInterval(() => {
  expireMovementTimers().catch(err => console.error('Failed to expire movement timers', err));
}, 30_000);
setInterval(() => {
  expireAwaitingConfirm().catch(err => console.error('Failed to expire awaiting confirmations', err));
}, 30_000);

rollupDailyMetrics().catch(err => console.error('Failed to roll up daily metrics', err));
setInterval(() => {
  rollupDailyMetrics().catch(err => console.error('Failed to roll up daily metrics', err));
}, 24 * 60 * 60 * 1000);

bot.command('ping', (ctx) => ctx.reply('pong'));

const MAX_LAUNCH_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function launchBot() {
  for (let attempt = 1; attempt <= MAX_LAUNCH_ATTEMPTS; attempt++) {
    try {
      await bot.launch();
      console.log('Bot started');
      return;
    } catch (err) {
      if (err instanceof TelegramError) {
        const errorCode = err.response?.error_code;
        const onMethod =
          typeof err.on === 'object' && err.on !== null ? (err.on as { method?: string }).method : undefined;

        if (errorCode === 409) {
          console.error('Bot launch failed: another instance is already running.', err);
          const reset = await resetTelegramSession(bot.telegram);
          if (reset && attempt < MAX_LAUNCH_ATTEMPTS) {
            console.warn(`Retrying bot launch after resetting session (attempt ${attempt + 1} of ${MAX_LAUNCH_ATTEMPTS})`);
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          if (reset) {
            console.error('Bot launch failed after resetting Telegram session', err);
          } else {
            console.error('Unable to reset Telegram session; aborting bot launch.');
          }
        } else if (errorCode === 500 && onMethod === 'deleteWebhook') {
          console.error('Bot launch failed while deleting webhook via Telegram API.', err);
          if (attempt < MAX_LAUNCH_ATTEMPTS) {
            console.warn(
              `Retrying bot launch after Telegram deleteWebhook error (attempt ${attempt + 1} of ${MAX_LAUNCH_ATTEMPTS})`,
            );
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          console.error('Exceeded retry attempts after Telegram deleteWebhook errors.');
        } else if (errorCode === 400 || err.description?.includes('Logged out')) {
          console.error(
            'Invalid or revoked TELEGRAM_BOT_TOKEN. Request a new token from @BotFather and set it in your environment.',
          );
          process.exit(1);
        } else {
          console.error('Bot launch failed', err);
        }
      } else {
        console.error('Bot launch failed', err);
      }
      break;
    }
  }
  console.error('Unable to start bot after maximum retries. Exiting.');
  process.exit(1);
}

launchBot();

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
