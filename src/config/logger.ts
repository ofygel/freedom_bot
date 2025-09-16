import pino from 'pino';

import { config } from './env';

export type Logger = pino.Logger;

export const logger: Logger = pino({
  level: config.logLevel,
  base: {
    service: 'freedom-bot',
    environment: config.nodeEnv,
  },
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
