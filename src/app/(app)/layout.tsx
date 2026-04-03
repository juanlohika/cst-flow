import { auth } from "@/auth";
import { db } from "@/db";
import { apps as appsTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import AppShell from "@/components/layout/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  
  // High-Performance Data Fetching (SSR)
  const dbApps = await db.select()
    .from(appsTable)
    .where(eq(appsTable.isActive, true))
    .orderBy(asc(appsTable.sortOrder), asc(appsTable.name));

  // Filter out internal system apps
  const filteredApps = dbApps.filter(app => !["meeting-prep", "tasks"].includes(app.slug));

  return (
    <AppShell 
      initialApps={filteredApps} 
      user={session?.user}
    >
      {children}
    </AppShell>
  );
}
