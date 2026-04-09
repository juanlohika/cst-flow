import { db } from "./src/db";
import { apps } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Checking App table...");
  const existing = await db.select().from(apps).where(eq(apps.slug, "presentations"));
  
  if (existing.length === 0) {
    console.log("Inserting Slide Builder app into App registry...");
    await db.insert(apps).values({
      name: "Slide Builder",
      slug: "presentations",
      description: "AI-powered presentation and slide generator",
      icon: "MonitorPlay",
      href: "/presentations",
      isActive: true,
      isBuiltIn: false,
      sortOrder: 4,
    });
    console.log("Insertion complete.");
  } else {
    console.log("Slide Builder already exists in App registry:", existing[0]);
  }
}

main().catch(console.error).then(() => process.exit(0));
