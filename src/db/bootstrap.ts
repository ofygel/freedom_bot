import { logger } from '../config';
import { runPendingMigrations, type MigrationEvent } from './migrations';

let schemaReady = false;
let bootstrapPromise: Promise<void> | null = null;

const logMigrationEvent = ({ name, action }: MigrationEvent): void => {
  if (action === 'skip') {
    logger.debug({ migration: name }, 'Skipping already applied migration during bootstrap');
  } else {
    logger.info({ migration: name }, 'Applying migration during bootstrap');
  }
};

const applyMigrations = async (): Promise<void> => {
  const applied = await runPendingMigrations(logMigrationEvent);
  if (applied === 0) {
    logger.debug('No pending database migrations found');
  }
  schemaReady = true;
};

export const ensureDatabaseSchema = async (): Promise<void> => {
  if (schemaReady) {
    return;
  }

  if (!bootstrapPromise) {
    bootstrapPromise = applyMigrations()
      .catch((error) => {
        logger.error({ err: error }, 'Failed to apply database migrations');
        throw error;
      })
      .finally(() => {
        bootstrapPromise = null;
      });
  }

  await bootstrapPromise;

  if (!schemaReady) {
    throw new Error('Database schema migration failed');
  }
};

/**
 * Testing helper used to reset the bootstrap state between test cases.
 * Not intended for production use.
 */
export const resetDatabaseSchemaCache = (): void => {
  schemaReady = false;
  bootstrapPromise = null;
};
