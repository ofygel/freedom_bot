import { config as loadEnv } from 'dotenv';
import type { LevelWithSilent } from 'pino';

loadEnv();

const REQUIRED_ENV_VARS = ['BOT_TOKEN', 'DATABASE_URL'] as const;

type RequiredEnvVar = (typeof REQUIRED_ENV_VARS)[number];

const LOG_LEVELS: LevelWithSilent[] = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
];

const missingVars = REQUIRED_ENV_VARS.filter((key) => {
  const value = process.env[key];
  return value === undefined || value.trim() === '';
});

if (missingVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
}

const parseBoolean = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }

  switch (value.toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
      return true;
    default:
      return false;
  }
};

const resolveLogLevel = (value: string | undefined): LevelWithSilent => {
  if (!value) {
    return 'info';
  }

  const normalised = value.toLowerCase() as LevelWithSilent;
  if (!LOG_LEVELS.includes(normalised)) {
    throw new Error(`Unsupported LOG_LEVEL provided: ${value}`);
  }

  return normalised;
};

export interface AppConfig {
  nodeEnv: string;
  logLevel: LevelWithSilent;
  bot: {
    token: string;
  };
  database: {
    url: string;
    ssl: boolean;
  };
}

export const config: AppConfig = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: resolveLogLevel(process.env.LOG_LEVEL),
  bot: {
    token: process.env.BOT_TOKEN as string,
  },
  database: {
    url: process.env.DATABASE_URL as string,
    ssl: parseBoolean(process.env.DATABASE_SSL),
  },
});

export type { RequiredEnvVar };
