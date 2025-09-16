import { app, setupGracefulShutdown } from './app';
import { logger } from './config';

const start = async (): Promise<void> => {
  try {
    await app.launch();
    logger.info('Bot started using long polling');
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to launch bot');
    process.exitCode = 1;
  }
};

setupGracefulShutdown(app);

void start();
