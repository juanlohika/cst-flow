import LeftNav from "@/components/layout/LeftNav";
import GlobalBar from "@/components/layout/GlobalBar";
import { auth } from "@/auth";
import { BreadcrumbProvider } from "@/lib/contexts/BreadcrumbContext";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  return (
    <BreadcrumbProvider>
      <div className="page-shell">
        {session && <LeftNav />}
        <div className={session ? "page-content" : "page-content-full"}>
          <GlobalBar />
          {children}
        </div>
      </div>
    </BreadcrumbProvider>
  );
}
