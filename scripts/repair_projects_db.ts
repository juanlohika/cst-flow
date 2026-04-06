import { db } from "./src/db";
import { sql } from "drizzle-orm";

async function repairSchema() {
    try {
        console.log("⚡ Starting Database Schema Repair...");

        // 1. ADD MISSING COLUMN: assignedIds
        // Using raw SQL directly to avoid any type-checking issues in the script
        await db.run(sql`ALTER TABLE Project ADD COLUMN assignedIds TEXT`);
        console.log("✅ Column 'assignedIds' added successfully.");

        // 2. CLEANUP LEGACY DATA: Delete the 'Accutech' project
        // This ensures the user starts with a clean slate matching the new schema
        await db.run(sql`DELETE FROM Project WHERE name = 'Accutech'`);
        console.log("✅ Legacy 'Accutech' project removed.");

        console.log("\n🚀 Schema repair complete. Projects API should now return 200 OK.");
        process.exit(0);
    } catch (error: any) {
        if (error.message.includes("duplicate column name")) {
             console.warn("⚠️ Column 'assignedIds' already exists.");
             process.exit(0);
        }
        console.error("❌ Repair Failed:", error.message);
        process.exit(1);
    }
}

repairSchema();
