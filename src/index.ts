import { app, isShutdownInProgress, setupGracefulShutdown } from './app';
import { logger } from './config';
import { registerJobs } from './jobs';

const gracefulShutdownErrorPatterns = [
  /bot is not running/i,
  /bot has not been started/i,
  /stop\s+.*before\s+start/i,
];

const isAbortSignalError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const candidate = error as { name?: unknown; code?: unknown };

  if (candidate.name === 'AbortError' || candidate.code === 'ABORT_ERR') {
    return true;
  }

  return false;
};

const matchesGracefulShutdownMessage = (message: unknown): boolean =>
  typeof message === 'string' && gracefulShutdownErrorPatterns.some((pattern) => pattern.test(message));

const isGracefulShutdownError = (error: unknown): boolean => {
  if (isAbortSignalError(error)) {
    return true;
  }

  if (typeof error === 'string') {
    return matchesGracefulShutdownMessage(error);
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = error as { message?: unknown };
    if (matchesGracefulShutdownMessage(candidate.message)) {
      return true;
    }
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return matchesGracefulShutdownMessage(error.message);
};

const start = async (): Promise<void> => {
  try {
    await app.launch();
    registerJobs(app);
    logger.info('Bot started using long polling');
  } catch (error) {
    if (isShutdownInProgress()) {
      logger.info({ err: error }, 'Bot stopped gracefully');
    } else if (isGracefulShutdownError(error)) {
      logger.info({ err: error }, 'Bot stopped gracefully');
    } else {
      logger.fatal({ err: error }, 'Failed to start bot or jobs');
      process.exitCode = 1;
    }
  }
};

setupGracefulShutdown(app);

void start();
