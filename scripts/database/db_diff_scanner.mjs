import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

async function run() {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  if (!fs.existsSync(schemaPath)) {
    console.error("No prisma schema found");
    return;
  }
  
  const content = fs.readFileSync(schemaPath, "utf-8");
  const models = {};
  
  let currentModel = null;
  content.split("\n").forEach(line => {
    line = line.trim();
    if (line.startsWith("model ")) {
      currentModel = line.split(/\s+/)[1];
      models[currentModel] = [];
    } else if (currentModel && line.startsWith("}")) {
      currentModel = null;
    } else if (currentModel && line && !line.startsWith("//") && !line.startsWith("@@")) {
      const field = line.split(/\s+/)[0];
      if (field && !field.includes("(")) {
        models[currentModel].push(field);
      }
    }
  });

  console.log("=== DB SCHEMA DIFF SCANNER ===");
  let missingCount = 0;
  let allMissing = [];

  for (const model of Object.keys(models)) {
    try {
      const res = await client.execute(`PRAGMA table_info(${model});`);
      if (res.rows.length === 0) {
        console.log(`❌ TABLE MISSING IN TURSO: ${model}`);
        missingCount++;
        continue;
      }
      
      const tursoColumns = new Set(res.rows.map(r => r[1]));
      const prismaColumns = models[model];
      
      const missing = [];
      for (const expected of prismaColumns) {
        // Skip relations (which don't exist as simple columns typically, but we can filter naive relational fields)
        // A naive heuristic: if a field isn't in turso DB, check if it's a relation (e.g. capitalized type or array)
        if (!tursoColumns.has(expected)) {
            // we will list it, but let's review it manually in output
            missing.push(expected);
        }
      }

      if (missing.length > 0) {
        console.log(`⚠️ TABLE [${model}] is missing columns in Turso:`);
        missing.forEach(m => console.log(`   -> missing: ${m}`));
        missingCount++;
        allMissing.push({ model, missing });
      } else {
        console.log(`✅ TABLE [${model}] is perfectly mapped.`);
      }
    } catch(e) {
       console.log(`Error checking table ${model}: ${e.message}`);
    }
  }

  console.log(`\nScan Complete. Total discrepancies: ${missingCount}`);
}

run();
