import { Telegraf } from 'telegraf';

import { registerBindCommand } from './bot/commands/bind';
import { registerStartCommand } from './bot/commands/start';
import { registerDeliveryOrderFlow } from './bot/flows/client/deliveryOrderFlow';
import { registerClientMenu } from './bot/flows/client/menu';
import { registerClientOrdersFlow } from './bot/flows/client/orders';
import { registerTaxiOrderFlow } from './bot/flows/client/taxiOrderFlow';
import { registerExecutorMenu } from './bot/flows/executor/menu';
import { registerExecutorRoleSelect } from './bot/flows/executor/roleSelect';
import { registerExecutorSubscription } from './bot/flows/executor/subscription';
import { registerExecutorVerification } from './bot/flows/executor/verification';
import { registerJoinRequests } from './bot/channels/joinRequests';
import { registerOrdersChannel } from './bot/channels/ordersChannel';
import { registerPaymentModerationQueue } from './bot/moderation/paymentQueue';
import { registerVerificationModerationQueue } from './bot/moderation/verifyQueue';
import { auth } from './bot/middlewares/auth';
import { autoDelete } from './bot/middlewares/autoDelete';
import { errorBoundary } from './bot/middlewares/errorBoundary';
import { session } from './bot/middlewares/session';
import type { BotContext } from './bot/types';
import { config, logger } from './config';
import { pool } from './db';

export const app = new Telegraf<BotContext>(config.bot.token);

app.catch((error, ctx) => {
  logger.error({ err: error, update: ctx.update }, 'Unhandled error in Telegraf');
});

app.use(errorBoundary());
app.use(session());
app.use(autoDelete());
app.use(auth());

registerStartCommand(app);
registerBindCommand(app);
registerClientMenu(app);
registerClientOrdersFlow(app);
registerTaxiOrderFlow(app);
registerDeliveryOrderFlow(app);
registerExecutorRoleSelect(app);
registerExecutorVerification(app);
registerExecutorSubscription(app);
registerExecutorMenu(app);
registerVerificationModerationQueue(app);
registerPaymentModerationQueue(app);
registerOrdersChannel(app);
registerJoinRequests(app);

let gracefulShutdownConfigured = false;
let cleanupStarted = false;

export const isShutdownInProgress = (): boolean => cleanupStarted;

const botAlreadyStoppedPatterns = [
  /bot is not running/i,
  /bot has not been started/i,
  /stop\s+.*before\s+start/i,
];

const isBotAlreadyStoppedError = (error: unknown): error is Error => {
  if (!(error instanceof Error)) {
    return false;
  }

  return botAlreadyStoppedPatterns.some((pattern) => pattern.test(error.message));
};

export const setupGracefulShutdown = (bot: Telegraf<BotContext>): void => {
  if (gracefulShutdownConfigured) {
    return;
  }
  gracefulShutdownConfigured = true;

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.once(signal, () => {
      if (cleanupStarted) {
        return;
      }
      cleanupStarted = true;

      logger.info({ signal }, 'Received shutdown signal, stopping bot');
      const cleanup = async (): Promise<void> => {
        try {
          try {
            bot.stop(`Received ${signal}`);
          } catch (error) {
            if (isBotAlreadyStoppedError(error)) {
              logger.warn({ err: error }, 'Bot already stopped before cleanup, continuing shutdown');
            } else {
              throw error;
            }
          }
          await pool.end();
          logger.info('Shutdown cleanup completed, exiting process');
          process.exit(0);
        } catch (error) {
          logger.error({ err: error }, 'Failed to shutdown gracefully');
          process.exitCode = 1;
          process.exit(1);
        }
      };

      void cleanup();
    });
  }
};

setupGracefulShutdown(app);
