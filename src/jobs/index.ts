import type { Telegraf } from 'telegraf';

import type { BotContext } from '../bot/types';
import { startSubscriptionScheduler } from './scheduler';

let initialized = false;

export const registerJobs = (bot: Telegraf<BotContext>): void => {
  if (initialized) {
    return;
  }

  startSubscriptionScheduler(bot);
  initialized = true;
};
