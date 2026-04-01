"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Compass, Zap, Building2, Sparkles, FolderOpen, LayoutDashboard
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles size={14} />,
};

export default function LeftNav() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(false);
  const [aiApps, setAiApps] = useState<any[]>([]);
  const [taskProjects, setTaskProjects] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

  const isAiAppActive = aiApps.some(a => pathname?.startsWith(a.href));
  const isTasksActive = pathname?.startsWith("/tasks") ?? false;

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleMouseEnter = () => {
    if (!isCollapsed) return;
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 400); 
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setIsHovered(false);
  };

  useEffect(() => {
    fetch("/api/apps")
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          setAiApps(data.filter((a: any) => a.isActive && !["meeting-prep", "tasks"].includes(a.slug)));
        }
      });
  }, []);

  if (!session) return null;

  const isActive = (href: string) => {
    if (!mounted) return false;
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  const isFloating = isCollapsed && isHovered;
  const sidebarWidth = isCollapsed ? (isFloating ? 255 : 72) : 255;

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`left-nav relative h-screen bg-white border-r transition-all duration-400 ease-in-out flex-shrink-0 group ${isFloating ? "z-[9999]" : "z-50"}`}
      style={{ width: isCollapsed && !isFloating ? 72 : 255 }}
    >
      {/* Visual Container (The "Smart" part that handles the expansion separately from the flex-width) */}
      <div 
        className={`absolute left-0 top-0 bottom-0 bg-white border-r flex flex-col overflow-hidden transition-all duration-400 ${isFloating ? "shadow-2xl border-r-primary/20" : ""}`}
        style={{ width: sidebarWidth }}
      >
        {/* Header */}
        <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
          {(!isCollapsed || isFloating) ? (
            <>
              <Link href="/" className="flex items-center gap-2">
                <div className="w-5 h-5 bg-primary rounded flex items-center justify-center text-[8px] font-black text-white">CST</div>
                <span className="text-[12px] font-bold text-slate-800 uppercase tracking-tighter">FlowDesk</span>
              </Link>
              <button onClick={() => setIsCollapsed(true)} className="p-1 hover:bg-slate-100 rounded text-slate-400">
                <ChevronLeft size={14} />
              </button>
            </>
          ) : (
            <Link href="/" className="mx-auto">
              <div className="w-6 h-6 bg-primary rounded flex items-center justify-center text-[10px] font-black text-white shadow-sm">CST</div>
            </Link>
          )}
        </div>

        {/* Nav List */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-0.5 styled-scroll mt-1">
          {(!isCollapsed || isFloating) ? (
            <>
              <Link href="/" className={`left-nav-item ${isActive("/") ? "active" : ""}`}>
                <Compass size={14} /> <span>Explore</span>
              </Link>
              <Link href="/accounts" className={`left-nav-item ${isActive("/accounts") ? "active" : ""}`}>
                <Building2 size={14} /> <span>Accounts</span>
              </Link>

              <div className="mt-1">
                <button onClick={() => setAiAppsOpen(!aiAppsOpen)} className={`left-nav-item w-full ${isAiAppActive ? "active" : ""}`}>
                  <Sparkles size={14} /> <span className="flex-1">AI Intelligence</span>
                  <ChevronDown size={12} className={`transition-transform ${aiAppsOpen ? "rotate-180" : ""}`} />
                </button>
                {aiAppsOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                    {aiApps.map(app => (
                      <Link key={app.id} href={app.href} className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium ${isActive(app.href) ? "text-primary bg-primary/5" : "text-slate-500 hover:bg-slate-50"}`}>
                        {ICON_MAP[app.icon ?? ""] || <Sparkles size={12} />}
                        <span>{app.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-1">
                <Link href="/tasks" className={`left-nav-item ${isTasksActive ? "active" : ""}`}>
                  <Zap size={14} /> <span>Tasks</span>
                </Link>
              </div>

              {session?.user?.role === "admin" && (
                <div className="mt-4 border-t pt-4">
                  <div className="px-3 mb-2 text-[10px] font-black uppercase text-slate-400 tracking-widest">Administration</div>
                  <Link href="/admin" className={`left-nav-item ${isActive("/admin") ? "active" : ""}`}>
                    <LayoutDashboard size={14} /> <span>Admin Console</span>
                  </Link>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <Link href="/" className={`p-2 rounded-md ${isActive("/") ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Explore"><Compass size={18}/></Link>
              <Link href="/accounts" className={`p-2 rounded-md ${isActive("/accounts") ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Accounts"><Building2 size={18}/></Link>
              <Link href="/tasks" className={`p-2 rounded-md ${isTasksActive ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Tasks"><Zap size={18}/></Link>
              {session?.user?.role === "admin" && (
                <Link href="/admin" className={`p-2 rounded-md ${isActive("/admin") ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Admin Console"><LayoutDashboard size={18}/></Link>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t mt-auto">
           {(!isCollapsed || isFloating) ? (
             <button onClick={() => setIsCollapsed(!isCollapsed)} className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-slate-50 rounded-md">
                <span>Collapse Menu</span>
                <ChevronLeft size={12} />
             </button>
           ) : (
             <button onClick={() => setIsCollapsed(false)} className="mx-auto p-1 text-slate-300 hover:text-primary transition-colors">
                <ChevronRight size={14} />
             </button>
           )}
        </div>
      </div>
    </aside>
  );
}
