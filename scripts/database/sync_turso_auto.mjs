import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: ".env.local" });

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const TYPE_MAPPING = {
  String: "TEXT",
  Int: "INTEGER",
  Boolean: "BOOLEAN",
  DateTime: "DATETIME",
  Float: "REAL"
};

async function run() {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  const content = fs.readFileSync(schemaPath, "utf-8");
  
  const models = {};
  let currentModel = null;
  
  content.split("\n").forEach(line => {
    line = line.trim();
    if (line.startsWith("model ")) {
      currentModel = line.split(/\s+/)[1];
      models[currentModel] = { fields: [], createString: "" };
    } else if (currentModel && line.startsWith("}")) {
      currentModel = null;
    } else if (currentModel && line && !line.startsWith("//") && !line.startsWith("@@")) {
      const parts = line.split(/\s+/);
      const fieldName = parts[0];
      let fieldType = parts[1];
      
      if (!fieldName || fieldName.includes("(")) return;
      
      const isList = fieldType.includes("[]");
      const isOptional = fieldType.includes("?");
      const baseType = fieldType.replace("?", "").replace("[]", "");

      // Ignore relational fields explicitly (capitalized starting letter is a Model, or it's a List)
      if (isList || (!TYPE_MAPPING[baseType] && baseType !== "Json")) {
        return; 
      }
      
      const sqliteType = TYPE_MAPPING[baseType] || "TEXT";
      
      let defaultVal = "";
      if (line.includes("@default(")) {
        const match = line.match(/@default\((.*?)\)/);
        if (match) {
          defaultVal = match[1];
          if (defaultVal === "now()") defaultVal = "CURRENT_TIMESTAMP";
          else if (defaultVal === "uuid()" || defaultVal === "cuid()") defaultVal = ""; // handle via app logic
          else if (defaultVal === "false") defaultVal = "0";
          else if (defaultVal === "true") defaultVal = "1";
        }
      }
      
      models[currentModel].fields.push({
        name: fieldName,
        type: sqliteType,
        isOptional,
        isId: line.includes("@id"),
        default: defaultVal
      });
    }
  });

  console.log("=== AUTO-SYNC TURSO DATABASE ===");

  for (const model of Object.keys(models)) {
    try {
      const res = await client.execute(`PRAGMA table_info(${model});`);
      const fields = models[model].fields;
      
      if (res.rows.length === 0) {
        console.log(`[CREATE TABLE] ${model}`);
        const colDefs = fields.map(f => {
           let def = `"${f.name}" ${f.type}`;
           if (f.isId) def += " PRIMARY KEY";
           if (!f.isOptional && !f.isId && !f.default) def += ""; 
           if (f.default) def += ` DEFAULT ${f.default.startsWith('"') ? f.default : (isNaN(f.default) && f.default !== "CURRENT_TIMESTAMP" ? '"'+f.default+'"' : f.default)}`;
           return def;
        }).join(", ");
        
        const createSql = `CREATE TABLE IF NOT EXISTS ${model} (${colDefs})`;
        await client.execute(createSql);
        console.log(`  -> SUCCESS`);
        continue;
      }
      
      const tursoColumns = new Set(res.rows.map(r => r[1]));
      
      for (const f of fields) {
        if (!tursoColumns.has(f.name)) {
          let sql = `ALTER TABLE ${model} ADD COLUMN "${f.name}" ${f.type}`;
          if (f.default) {
             let d = f.default;
             if (d === "CURRENT_TIMESTAMP") d = "'1970-01-01T00:00:00Z'"; // sqlite default strictness for datetime
             else if (!d.startsWith('"') && !d.startsWith("'")) {
                if(isNaN(d)) d = `"${d}"`;
             }
             sql += ` DEFAULT ${d}`;
          }
           
          console.log(`[ALTER TABLE] ${model} +${f.name}`);
          try {
             await client.execute(sql);
          } catch(err) {
             console.error(`  -> ERROR adding ${f.name}: ${err.message}`);
          }
        }
      }
    } catch(e) {
       console.log(`Error checking table ${model}: ${e.message}`);
    }
  }

  console.log(`\nSync complete!`);
}

run();
