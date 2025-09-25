import { pool } from '../src/db/client';
import { runPendingMigrations, type MigrationLogger } from '../src/db/migrations';

const cliLogger: MigrationLogger = ({ name, action }) => {
  if (action === 'skip') {
    console.log(`Skipping already applied migration ${name}`);
  } else {
    console.log(`Applying migration ${name}...`);
  }
};

const main = async (): Promise<void> => {
  try {
    const applied = await runPendingMigrations(cliLogger);
    if (applied === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied ${applied} migration${applied === 1 ? '' : 's'}.`);
    }
  } finally {
    await pool.end();
  }
};

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
