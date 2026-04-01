import LeftNav from "@/components/layout/LeftNav";
import GlobalBar from "@/components/layout/GlobalBar";
import { auth } from "@/auth";
import { BreadcrumbProvider } from "@/lib/contexts/BreadcrumbContext";
import { Suspense } from "react";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <BreadcrumbProvider>
      <div className="page-shell">
        {session && (
          <Suspense fallback={<div className="left-nav collapsed" />}>
            <LeftNav />
          </Suspense>
        )}
        <main className={session ? "page-content" : "page-content-full"}>
          <GlobalBar />
          <div className="flex-1 overflow-auto bg-surface-subtle">
            {children}
          </div>
        </main>
      </div>
    </BreadcrumbProvider>
  );
}
