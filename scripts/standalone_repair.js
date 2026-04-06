const { createClient } = require("@libsql/client");

// MANUALLY GRABBING FROM THE ENV WE DISCOVERED EARLIER
const url = "libsql://cst-flow-juanlohika.aws-ap-northeast-1.turso.io";
const authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzQ4Njk5NzIsImlkIjoiMDE5ZDNjYjktNmYwMS03YTgwLWJmMGMtODZkNjk5ZmRkOGZmIiwicmlkIjoiZjRhM2E2ZmUtMjEyMS00MTI4LWJjMmQtMWMxMDE0YjE2NDlkIn0.gkkigRIP7XWO5XPb5hV4nnI-51sIoyHYneeGP06tXCG30bmEPjT2AhCg0HpFUY5LSMKQDya_EuC2S22g-7b8AA";

async function repairSchema() {
    const client = createClient({ url, authToken });
    
    try {
        console.log("⚡ Starting Direct SQL Schema Repair...");

        // 1. ADD COLUMN: assignedIds
        try {
            await client.execute("ALTER TABLE Project ADD COLUMN assignedIds TEXT");
            console.log("✅ Column 'assignedIds' added.");
        } catch (e) {
            if (e.message.includes("duplicate column name")) {
                console.log("ℹ️ Column 'assignedIds' already exists.");
            } else {
                throw e;
            }
        }

        // 2. DELETE OLD PROJECT
        await client.execute("DELETE FROM Project WHERE name = 'Accutech'");
        console.log("✅ Legacy 'Accutech' project removed.");

        console.log("\n🚀 Schema repair complete.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Repair Failed:", error.message);
        process.exit(1);
    }
}

repairSchema();
