/**
 * Insert the "Pin Validator" entry into the App table so the LeftNav shows
 * /ai-tools under "AI Intelligence". Idempotent — does nothing if a row
 * with the same slug exists already.
 *
 * Run with:
 *   npx tsx scripts/seed-pin-validator-app.ts
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

async function main(): Promise<void> {
  const existing = await client.execute({
    sql: `SELECT id FROM App WHERE slug = ? LIMIT 1`,
    args: ["pin-validator"],
  });
  if (existing.rows.length > 0) {
    console.log("Pin Validator app row already exists — skipping.");
    return;
  }

  const id = `app_pv_${Math.random().toString(36).substring(2, 10)}`;
  const now = new Date().toISOString();
  await client.execute({
    sql: `INSERT INTO App (id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, provider, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      "Pin Validator",
      "pin-validator",
      "Generate a Google Sheet of store coordinates, geocode store names, and send a magic link to client validators.",
      "MapPin",
      "/ai-tools",
      1, // isActive
      0, // isBuiltIn
      90, // sortOrder — toward the bottom of the AI list
      null,
      now,
      now,
    ],
  });
  console.log("✓ Inserted Pin Validator app row.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
