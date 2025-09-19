import { Telegraf } from 'telegraf';

import { registerBindCommand } from './bot/commands/bind';
import { registerStartCommand } from './bot/commands/start';
import { registerCityCommand } from './bot/commands/city';
import { registerDeliveryOrderFlow } from './bot/flows/client/deliveryOrderFlow';
import { registerClientMenu } from './bot/flows/client/menu';
import { registerClientSupport } from './bot/flows/client/support';
import { registerClientFallback } from './bot/flows/client/fallback';
import { registerClientOrdersFlow } from './bot/flows/client/orders';
import { registerTaxiOrderFlow } from './bot/flows/client/taxiOrderFlow';
import { registerExecutorMenu } from './bot/flows/executor/menu';
import { registerExecutorOrders } from './bot/flows/executor/orders';
import { registerExecutorSupport } from './bot/flows/executor/support';
import { registerExecutorRoleSelect } from './bot/flows/executor/roleSelect';
import { registerExecutorSubscription } from './bot/flows/executor/subscription';
import { registerExecutorVerification } from './bot/flows/executor/verification';
import { registerJoinRequests } from './bot/channels/joinRequests';
import { registerOrdersChannel } from './bot/channels/ordersChannel';
import {
  registerPaymentModerationQueue,
  restorePaymentModerationQueue,
} from './bot/moderation/paymentQueue';
import {
  registerVerificationModerationQueue,
  restoreVerificationModerationQueue,
} from './bot/moderation/verifyQueue';
import {
  registerSupportModerationBridge,
  restoreSupportThreads,
} from './bot/services/support';
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
registerCityCommand(app);
registerClientMenu(app);
registerClientOrdersFlow(app);
registerTaxiOrderFlow(app);
registerDeliveryOrderFlow(app);
registerClientSupport(app);
registerClientFallback(app);
registerExecutorRoleSelect(app);
registerExecutorVerification(app);
registerExecutorSubscription(app);
registerExecutorOrders(app);
registerExecutorMenu(app);
registerExecutorSupport(app);
registerVerificationModerationQueue(app);
registerPaymentModerationQueue(app);
registerSupportModerationBridge(app);
registerOrdersChannel(app);
registerJoinRequests(app);

let gracefulShutdownConfigured = false;
let cleanupStarted = false;

type CleanupTask = () => Promise<void> | void;

const cleanupTasks: CleanupTask[] = [];

export const registerCleanupTask = (task: CleanupTask): void => {
  cleanupTasks.push(task);
};

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

          for (const task of cleanupTasks) {
            await Promise.resolve()
              .then(() => task())
              .catch((error) => {
                logger.error({ err: error }, 'Cleanup task failed');
                throw error;
              });
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

export const initialiseAppState = async (): Promise<void> => {
  const tasks: Promise<void>[] = [
    restoreVerificationModerationQueue().catch((error) => {
      logger.error({ err: error }, 'Failed to restore verification moderation queue');
    }),
    restorePaymentModerationQueue().catch((error) => {
      logger.error({ err: error }, 'Failed to restore payment moderation queue');
    }),
    restoreSupportThreads().catch((error) => {
      logger.error({ err: error }, 'Failed to restore support threads');
    }),
  ];

  await Promise.all(tasks);
};
