import LeftNav from "@/components/layout/LeftNav";
import GlobalBar from "@/components/layout/GlobalBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-shell">
      <LeftNav />
      <div className="page-content">
        {children}
      </div>
    </div>
  );
}
