import type { Telegraf } from 'telegraf';

import type { BotContext } from '../bot/types';
import { startSubscriptionScheduler, stopSubscriptionScheduler } from './scheduler';
import { startInactivityNudger, stopInactivityNudger } from './nudger';
import { startMetricsReporter, stopMetricsReporter } from './metricsReporter';

let initialized = false;

export const registerJobs = (bot: Telegraf<BotContext>): void => {
  if (initialized) {
    return;
  }

  startSubscriptionScheduler(bot);
  startInactivityNudger(bot);
  startMetricsReporter();
  initialized = true;
};

export const stopJobs = (): void => {
  if (!initialized) {
    return;
  }

  stopInactivityNudger();
  stopSubscriptionScheduler();
  stopMetricsReporter();
  initialized = false;
};
