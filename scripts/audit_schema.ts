import { db } from "./src/db";
import { sql } from "drizzle-orm";

async function checkSchema() {
    try {
        console.log("Auditing Project Table Structure...");
        // PRAGMA table_info is the standard way to check columns in SQLite/LibSQL
        const rows: any = await db.run(sql`PRAGMA table_info(Project)`);
        console.log("Columns found in Project table:");
        rows.rows.forEach((row: any) => {
            console.log(`- ${row.name} (${row.type})`);
        });
        
        const hasAssignedIds = rows.rows.some((r: any) => r.name === 'assignedIds');
        console.log("\nAssignedIds column exists:", hasAssignedIds);
        
        process.exit(0);
    } catch (error) {
        console.error("Audit Failed:", error);
        process.exit(1);
    }
}

checkSchema();
