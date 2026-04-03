import LeftNav from "@/components/layout/LeftNav";
import GlobalBar from "@/components/layout/GlobalBar";
import { auth } from "@/auth";
import { BreadcrumbProvider } from "@/lib/contexts/BreadcrumbContext";
import { db } from "@/db";
import { apps as appsTable } from "@/db/schema";
import { asc, eq, and } from "drizzle-orm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  
  // High-Performance Data Fetching (SSR)
  // Fetch apps once on the server to prevent 'Hydration Lag' in the sidebar
  const dbApps = await db.select()
    .from(appsTable)
    .where(eq(appsTable.isActive, true))
    .orderBy(asc(appsTable.sortOrder), asc(appsTable.name));

  // Filter out internal system apps that don't belong in the main AI sub-menu
  const filteredApps = dbApps.filter(app => !["meeting-prep", "tasks"].includes(app.slug));

  return (
    <BreadcrumbProvider>
      <div className="page-shell bg-surface-subtle">
        {session && <LeftNav initialApps={filteredApps} user={session.user} />}
        <main className={session ? "page-content" : "page-content-full"}>
          <GlobalBar />
          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
    </BreadcrumbProvider>
  );
}
