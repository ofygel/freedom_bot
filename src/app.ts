import { Telegraf } from 'telegraf';

import { registerBindCommand } from './bot/commands/bind';
import { registerStartCommand } from './bot/commands/start';
import { registerDeliveryOrderFlow } from './bot/flows/client/deliveryOrderFlow';
import { registerClientMenu } from './bot/flows/client/menu';
import { registerTaxiOrderFlow } from './bot/flows/client/taxiOrderFlow';
import { registerExecutorMenu } from './bot/flows/executor/menu';
import { registerExecutorRoleSelect } from './bot/flows/executor/roleSelect';
import { registerExecutorSubscription } from './bot/flows/executor/subscription';
import { registerExecutorVerification } from './bot/flows/executor/verification';
import { auth } from './bot/middlewares/auth';
import { autoDelete } from './bot/middlewares/auto-delete';
import { errorBoundary } from './bot/middlewares/error-boundary';
import { session } from './bot/middlewares/session';
import type { BotContext } from './bot/types';
import { config, logger } from './config';

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
registerTaxiOrderFlow(app);
registerDeliveryOrderFlow(app);
registerExecutorRoleSelect(app);
registerExecutorVerification(app);
registerExecutorSubscription(app);
registerExecutorMenu(app);

let gracefulShutdownConfigured = false;

export const setupGracefulShutdown = (bot: Telegraf<BotContext>): void => {
  if (gracefulShutdownConfigured) {
    return;
  }
  gracefulShutdownConfigured = true;

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.once(signal, () => {
      logger.info({ signal }, 'Received shutdown signal, stopping bot');
      void bot.stop(`Received ${signal}`);
    });
  }
};

setupGracefulShutdown(app);
