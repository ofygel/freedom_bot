import express from 'express';
import type { Server } from 'http';

import {
  app,
  initialiseAppState,
  isShutdownInProgress,
  registerCleanupTask,
  setupGracefulShutdown,
} from './app';
import { config, logger } from './config';
import { healthHandler, readinessHandler } from './http/health';
import { metricsHandler } from './http/metrics';
import { openApiHandler } from './http/docs';
import { registerJobs, stopJobs } from './jobs';

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

const removeTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

const buildWebhookConfig = (domain: string, secret: string) => {
  const trimmedDomain = removeTrailingSlashes(domain);
  const path = `/bot/${secret}`;
  return {
    path,
    url: `${trimmedDomain}${path}`,
  };
};

const parsePort = (value: string | undefined): number => {
  if (!value) {
    return 3000;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return parsed;
};

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const startServer = async (webhookPath: string, port: number): Promise<Server> => {
  const serverApp = express();

  serverApp.use(express.json());

  serverApp.post(webhookPath, (req, res) => {
    void app.handleUpdate(req.body);
    res.sendStatus(200);
  });

  serverApp.get('/health', healthHandler);
  serverApp.get('/healthz', healthHandler);
  serverApp.get('/readyz', readinessHandler);
  serverApp.get('/metrics', metricsHandler);
  serverApp.get('/openapi.json', openApiHandler);

  return await new Promise<Server>((resolve, reject) => {
    const httpServer = serverApp.listen(port, '0.0.0.0', () => {
      resolve(httpServer);
    });

    httpServer.on('error', (error) => {
      httpServer.close();
      reject(error);
    });
  });
};

const start = async (): Promise<void> => {
  let server: Server | null = null;
  try {
    await initialiseAppState();
    const { url, path } = buildWebhookConfig(config.webhook.domain, config.webhook.secret);
    const port = parsePort(process.env.PORT);

    server = await startServer(path, port);
    const httpServer = server;
    logger.info({ port }, 'Webhook server listening for updates');

    try {
      await app.telegram.setWebhook(url);
    } catch (webhookError) {
      await closeServer(httpServer).catch((error) => {
        logger.error({ err: error }, 'Failed to close webhook server after registration error');
      });
      server = null;
      throw webhookError;
    }

    registerCleanupTask(() => closeServer(httpServer));

    registerJobs(app);
    registerCleanupTask(() => {
      stopJobs();
    });

    logger.info({ url }, 'Webhook registered');
    logger.info({ port, path }, 'Bot started using webhook');
  } catch (error) {
    if (server) {
      await closeServer(server).catch((closeError) => {
        logger.error({ err: closeError }, 'Failed to close webhook server during startup failure');
      });
    }

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
