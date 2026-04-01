/**
 * RESTORE ADMIN SCRIPT
 * 
 * Re-elevates the user to admin inside the remote Turso/LibSQL database.
 */
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as path from "path";
import { users } from "../src/db/schema";
import { eq, or } from "drizzle-orm";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function main() {
  const url = process.env.DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN;

  if (!url) throw new Error("DATABASE_URL is missing");

  console.log("⚡ Connecting to Turso...");
  const client = createClient({ url, authToken });
  const db = drizzle(client);

  console.log("🔍 Searching for user 'tarkielester'...");
  
  // Update by common Tarkie emails / names
  const result = await db.update(users)
    .set({ 
      role: 'admin', 
      isSuperAdmin: true,
      status: 'active'
    })
    .where(
      or(
        eq(users.email, "tarkielester@mobileoptima.com"),
        eq(users.email, "tarkielester@gmail.com"),
        eq(users.email, "lestersalesalarcon@gmail.com"),
        eq(users.name, "TARKIE LESTER"),
        eq(users.name, "tarkielester")
      )
    )
    .returning();

  if (result.length > 0) {
    console.log("✅ SUCCESS: RESTORED ADMIN FOR:", result[0].email);
  } else {
    console.log("❌ FAILED: User not found. Listing all users for manual fix...");
    const allUsers = await db.select().from(users).limit(10);
    console.table(allUsers.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })));
  }

  process.exit(0);
}

main().catch(err => {
  console.error("error:", err);
  process.exit(1);
});
