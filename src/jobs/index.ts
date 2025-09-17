import type { Telegraf } from 'telegraf';

import type { BotContext } from '../bot/types';
import { startSubscriptionScheduler, stopSubscriptionScheduler } from './scheduler';

let initialized = false;

export const registerJobs = (bot: Telegraf<BotContext>): void => {
  if (initialized) {
    return;
  }

  startSubscriptionScheduler(bot);
  initialized = true;
};

export const stopJobs = (): void => {
  if (!initialized) {
    return;
  }

  stopSubscriptionScheduler();
  initialized = false;
};
