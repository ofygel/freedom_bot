import pino from 'pino';

import { config } from './env';

export type Logger = pino.Logger;

const transport = pino.transport({
  targets: [
    {
      target: 'pino/file',
      level: config.logLevel,
      options: { destination: 1, mkdir: false },
    },
  ],
});

export const logger: Logger = pino(
  {
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
  },
  transport,
);
