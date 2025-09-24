import { config as loadEnv } from 'dotenv';
import type { LevelWithSilent } from 'pino';

loadEnv();

const REQUIRED_ENV_VARS = [
  'BOT_TOKEN',
  'DATABASE_URL',
  'KASPI_CARD',
  'KASPI_NAME',
  'KASPI_PHONE',
  'WEBHOOK_DOMAIN',
  'WEBHOOK_SECRET',
] as const;

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

const getTrimmedEnv = (key: string): string | undefined => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const missingVars = REQUIRED_ENV_VARS.filter((key) => !getTrimmedEnv(key));

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

const parseWarnHours = (value: string | undefined): number => {
  if (!value) {
    return 24;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('SUB_WARN_HOURS_BEFORE must be a positive number');
  }

  return parsed;
};

const parseTariffValue = (envKey: string, defaultValue: number): number => {
  const raw = getTrimmedEnv(envKey);

  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${envKey} must be a non-negative number`);
  }

  return parsed;
};

const parsePositiveNumber = (envKey: string, defaultValue: number): number => {
  const raw = getTrimmedEnv(envKey);

  if (!raw) {
    return defaultValue;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envKey} must be a positive number`);
  }

  return parsed;
};

const parseOptionalPositiveNumber = (envKey: string): number | undefined => {
  const raw = getTrimmedEnv(envKey);
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${envKey} must be a positive number`);
  }

  return parsed;
};

const getRequiredString = (key: RequiredEnvVar): string => {
  const value = getTrimmedEnv(key);
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const getOptionalString = (key: string): string | undefined => getTrimmedEnv(key);

export interface TariffConfig {
  baseFare: number;
  perKm: number;
  minimumFare: number;
}

export interface PricingConfig {
  taxi: TariffConfig;
  delivery: TariffConfig;
}

export interface TariffRates {
  base: number;
  perKm: number;
  perMin: number;
}

const DEFAULT_TAXI_TARIFF: TariffConfig = {
  baseFare: 700,
  perKm: 200,
  minimumFare: 700,
};

const DEFAULT_DELIVERY_TARIFF: TariffConfig = {
  baseFare: 900,
  perKm: 250,
  minimumFare: 900,
};

const parseTariffConfig = (prefix: string, defaults: TariffConfig): TariffConfig => ({
  baseFare: parseTariffValue(`${prefix}_BASE_FARE`, defaults.baseFare),
  perKm: parseTariffValue(`${prefix}_PER_KM`, defaults.perKm),
  minimumFare: parseTariffValue(`${prefix}_MINIMUM_FARE`, defaults.minimumFare),
});

const loadPricingConfig = (): PricingConfig => ({
  taxi: parseTariffConfig('TAXI', DEFAULT_TAXI_TARIFF),
  delivery: parseTariffConfig('DELIVERY', DEFAULT_DELIVERY_TARIFF),
});

const parseGeneralTariff = (): TariffRates | null => {
  const base = parseOptionalPositiveNumber('TARIFF_BASE');
  const perKm = parseOptionalPositiveNumber('TARIFF_PER_KM');
  const perMin = parseOptionalPositiveNumber('TARIFF_PER_MIN');

  const definedValues = [base, perKm, perMin].filter((value) => value !== undefined).length;
  if (definedValues === 0) {
    return null;
  }

  if (definedValues !== 3) {
    throw new Error('TARIFF_BASE, TARIFF_PER_KM and TARIFF_PER_MIN must be defined together');
  }

  return {
    base: base as number,
    perKm: perKm as number,
    perMin: perMin as number,
  } satisfies TariffRates;
};

const parseSubscriptionPrices = () => ({
  sevenDays: parsePositiveNumber('SUB_PRICE_7', 5000),
  fifteenDays: parsePositiveNumber('SUB_PRICE_15', 9000),
  thirtyDays: parsePositiveNumber('SUB_PRICE_30', 16000),
  currency: 'KZT' as const,
});

export interface AppConfig {
  nodeEnv: string;
  logLevel: LevelWithSilent;
  bot: {
    token: string;
  };
  features: {
    trialEnabled: boolean;
    executorReplyKeyboard: boolean;
    reportsEnabled: boolean;
  };
  webhook: {
    domain: string;
    secret: string;
  };
  database: {
    url: string;
    ssl: boolean;
  };
  city: {
    default?: string;
  };
  tariff: TariffRates | null;
  subscriptions: {
    warnHoursBefore: number;
    trialDays: number;
    prices: {
      sevenDays: number;
      fifteenDays: number;
      thirtyDays: number;
      currency: string;
    };
    payment: {
      kaspi: {
        card: string;
        name: string;
        phone: string;
      };
      driversChannelInvite?: string;
    };
  };
  pricing: PricingConfig;
}

export const loadConfig = (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: resolveLogLevel(process.env.LOG_LEVEL),
  bot: {
    token: process.env.BOT_TOKEN as string,
  },
  features: {
    trialEnabled: parseBoolean(process.env.FEATURE_TRIAL_ENABLED),
    executorReplyKeyboard: parseBoolean(process.env.FEATURE_EXECUTOR_REPLY_KEYBOARD),
    reportsEnabled: parseBoolean(process.env.FEATURE_REPORTS_ENABLED),
  },
  webhook: {
    domain: getRequiredString('WEBHOOK_DOMAIN'),
    secret: getRequiredString('WEBHOOK_SECRET'),
  },
  database: {
    url: process.env.DATABASE_URL as string,
    ssl: parseBoolean(process.env.DATABASE_SSL),
  },
  city: {
    default: getOptionalString('CITY_DEFAULT'),
  },
  tariff: parseGeneralTariff(),
  subscriptions: {
    warnHoursBefore: parseWarnHours(process.env.SUB_WARN_HOURS_BEFORE),
    trialDays: parsePositiveNumber('SUB_TRIAL_DAYS', 7),
    prices: parseSubscriptionPrices(),
    payment: {
      kaspi: {
        card: getRequiredString('KASPI_CARD'),
        name: getRequiredString('KASPI_NAME'),
        phone: getRequiredString('KASPI_PHONE'),
      },
      driversChannelInvite: getOptionalString('DRIVERS_CHANNEL_INVITE'),
    },
  },
  pricing: loadPricingConfig(),
});

export const config: AppConfig = loadConfig();

Object.freeze(config.bot);
Object.freeze(config.features);
Object.freeze(config.webhook);
Object.freeze(config.database);
Object.freeze(config.city);
if (config.tariff) {
  Object.freeze(config.tariff);
}
Object.freeze(config.subscriptions.prices);
Object.freeze(config.subscriptions.payment.kaspi);
Object.freeze(config.subscriptions.payment);
Object.freeze(config.subscriptions);
Object.freeze(config.pricing.taxi);
Object.freeze(config.pricing.delivery);
Object.freeze(config.pricing);
Object.freeze(config);

export type { RequiredEnvVar };
