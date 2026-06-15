/**
 * One-off migration: add Pin Validator schema additions.
 *
 * Drizzle-kit's `push` command requires a TTY to disambiguate column adds
 * vs renames. Since all our additions are net-new (no renames), we apply
 * the SQL directly via @libsql/client and skip the prompt.
 *
 * Idempotent: each ALTER/CREATE is guarded so re-running is safe.
 *
 * Run from repo root:
 *   npx tsx scripts/migrate-pin-validator.ts
 */
import { config as loadEnv } from 'dotenv';
import { createClient } from '@libsql/client';

loadEnv({ path: '.env.local' });
loadEnv();

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) {
  console.error('DATABASE_URL missing. Check .env.local.');
  process.exit(1);
}

const client = createClient({ url, authToken });

async function tableHasColumn(table: string, column: string): Promise<boolean> {
  const res = await client.execute(`PRAGMA table_info("${table}")`);
  return res.rows.some((r) => (r as any).name === column);
}

async function tableExists(table: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  });
  return res.rows.length > 0;
}

async function addColumnIfMissing(
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  if (await tableHasColumn(table, column)) {
    console.log(`  • ${table}.${column} already exists, skipping`);
    return;
  }
  await client.execute(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`);
  console.log(`  ✓ ${table}.${column} added`);
}

async function main(): Promise<void> {
  console.log('Pin Validator schema migration');
  console.log('==============================');

  // 1. ClientContact: capability flags.
  console.log('\n[1] ClientContact capability flags');
  await addColumnIfMissing(
    'ClientContact',
    'arimaPortalEnabled',
    `"arimaPortalEnabled" integer NOT NULL DEFAULT 1`,
  );
  await addColumnIfMissing(
    'ClientContact',
    'pinValidatorEnabled',
    `"pinValidatorEnabled" integer NOT NULL DEFAULT 0`,
  );

  // 2. SubscriberMagicLink: purpose + pinValidatorProjectId.
  console.log('\n[2] SubscriberMagicLink scoping');
  await addColumnIfMissing(
    'SubscriberMagicLink',
    'purpose',
    `"purpose" text NOT NULL DEFAULT 'arima'`,
  );
  await addColumnIfMissing(
    'SubscriberMagicLink',
    'pinValidatorProjectId',
    `"pinValidatorProjectId" text`,
  );

  // 3. SubscriberSession: same.
  console.log('\n[3] SubscriberSession scoping');
  await addColumnIfMissing(
    'SubscriberSession',
    'purpose',
    `"purpose" text NOT NULL DEFAULT 'arima'`,
  );
  await addColumnIfMissing(
    'SubscriberSession',
    'pinValidatorProjectId',
    `"pinValidatorProjectId" text`,
  );

  // 4. PinValidatorProject: new table.
  console.log('\n[4] PinValidatorProject table');
  if (await tableExists('PinValidatorProject')) {
    console.log('  • PinValidatorProject already exists, skipping');
  } else {
    await client.execute(`
      CREATE TABLE "PinValidatorProject" (
        "id"               text PRIMARY KEY NOT NULL,
        "clientProfileId"  text NOT NULL,
        "googleSheetId"    text NOT NULL,
        "googleSheetUrl"   text NOT NULL,
        "name"             text NOT NULL,
        "status"           text NOT NULL DEFAULT 'active',
        "createdByUserId"  text,
        "createdAt"        text NOT NULL DEFAULT (datetime('now')),
        "updatedAt"        text NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id") ON DELETE CASCADE
      )
    `);
    console.log('  ✓ PinValidatorProject created');
  }

  console.log('\n✅ Migration complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  });
