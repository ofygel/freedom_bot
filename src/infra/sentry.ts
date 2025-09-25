import * as Sentry from '@sentry/node';

export const initSentry = (dsn?: string): void => {
  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    tracesSampleRate: 0.5,
    environment: process.env.NODE_ENV ?? 'development',
  });
};
