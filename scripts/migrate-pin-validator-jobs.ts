/**
 * One-off migration: add PinValidatorGeocodingJob.
 *
 * Idempotent — re-running is safe.
 *
 *   npx tsx scripts/migrate-pin-validator-jobs.ts
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@libsql/client";

loadEnv({ path: ".env.local" });
loadEnv();

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
if (!url) {
  console.error("DATABASE_URL missing. Check .env.local.");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function tableExists(table: string): Promise<boolean> {
  const res = await client.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  });
  return res.rows.length > 0;
}

async function main(): Promise<void> {
  console.log("Pin Validator geocoding-job migration");
  console.log("=====================================");

  if (await tableExists("PinValidatorGeocodingJob")) {
    console.log("  • PinValidatorGeocodingJob already exists, skipping");
  } else {
    await client.execute(`
      CREATE TABLE "PinValidatorGeocodingJob" (
        "id"               text PRIMARY KEY NOT NULL,
        "projectId"        text NOT NULL,
        "status"           text NOT NULL DEFAULT 'queued',
        "totalRows"        integer NOT NULL DEFAULT 0,
        "processedRows"    integer NOT NULL DEFAULT 0,
        "notFoundRows"     integer NOT NULL DEFAULT 0,
        "failedRows"       integer NOT NULL DEFAULT 0,
        "currentLocation"  text,
        "resting"          integer NOT NULL DEFAULT 0,
        "restUntilMs"      integer,
        "cancelRequested"  integer NOT NULL DEFAULT 0,
        "startedAt"        text NOT NULL DEFAULT (datetime('now')),
        "lastHeartbeatAt"  text NOT NULL DEFAULT (datetime('now')),
        "finishedAt"       text,
        "errorMessage"     text,
        "startedByUserId"  text,
        FOREIGN KEY ("projectId") REFERENCES "PinValidatorProject"("id") ON DELETE CASCADE
      )
    `);
    console.log("  ✓ PinValidatorGeocodingJob created");

    // Index to make 'find latest job for project' fast — used by the
    // status endpoint on every poll.
    await client.execute(`
      CREATE INDEX IF NOT EXISTS "idx_geo_job_project_started"
        ON "PinValidatorGeocodingJob" ("projectId", "startedAt")
    `);
    console.log("  ✓ idx_geo_job_project_started created");
  }

  console.log("\n✅ Migration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌ Migration failed:", err);
    process.exit(1);
  });
