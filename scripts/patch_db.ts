import { createClient } from "@libsql/client";
import path from "path";
import fs from "fs";

async function patchDb(dbPath: string) {
  const absolutePath = path.resolve(process.cwd(), dbPath);
  if (!fs.existsSync(absolutePath)) {
    console.log(`⚠️ Database not found at ${dbPath}, skipping.`);
    return;
  }

  console.log(`🔌 Patching database at ${dbPath}...`);
  const client = createClient({ url: `file:${absolutePath}` });

  try {
    // 1. Create the table manually
    await client.execute(`
      CREATE TABLE IF NOT EXISTS GlobalSetting (
        id TEXT PRIMARY KEY,
        [key] TEXT UNIQUE,
        value TEXT
      )
    `);
    console.log(`✅ Table GlobalSetting verified/created in ${dbPath}.`);

    // 2. Insert initial values if missing
    const settings = [
      { key: 'app_name', value: 'Team OS' },
      { key: 'bottom_logo_url', value: '' }
    ];

    for (const s of settings) {
      await client.execute({
        sql: "INSERT OR IGNORE INTO GlobalSetting (id, [key], value) VALUES (?, ?, ?)",
        args: [Math.random().toString(36).substring(7), s.key, s.value]
      });
    }
    console.log(`✅ Default settings seeded in ${dbPath}.`);

  } catch (error) {
    console.error(`❌ Error patching ${dbPath}:`, error);
  } finally {
    client.close();
  }
}

async function main() {
  await patchDb("./prisma/dev.db");
  await patchDb("./dev.db");
  process.exit(0);
}

main();
