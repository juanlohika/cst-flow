"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Compass, Zap, Building2, Sparkles, FolderOpen, LayoutDashboard,
  Network
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles size={14} />,
};

export default function LeftNav() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(false);
  const [aiApps, setAiApps] = useState<any[]>([]);
  const [mounted, setMounted] = useState(false);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const isAiAppActive = aiApps.some(a => pathname?.startsWith(a.href));
  const isTasksActive = pathname?.startsWith("/tasks") ?? false;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch("/api/apps")
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        if (Array.isArray(data)) {
          const apps = data.filter((a: any) => a.isActive && !["meeting-prep", "tasks"].includes(a.slug));
          setAiApps(apps);
          
          // AUTO-EXPAND: If current path is an AI App, open the menu immediately
          if (pathname && apps.some((a: any) => pathname.startsWith(a.href))) {
            setAiAppsOpen(true);
          }
        }
      });
  }, []);

  // Sync open state with navigation
  useEffect(() => {
    if (pathname && aiApps.some(a => pathname.startsWith(a.href))) {
      setAiAppsOpen(true);
    }
  }, [pathname, aiApps]);

  if (!session) return null;

  const isActive = (href: string) => {
    if (!mounted) return false;
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  const sidebarWidth = isCollapsed ? 64 : 240;

  return (
    <aside
      className={`left-nav transition-all duration-300 ease-in-out flex-shrink-0 flex flex-col`}
      style={{ width: sidebarWidth }}
    >
      {/* Header */}
      <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
        {!isCollapsed ? (
          <>
            <Link href="/" className="flex items-center gap-2 overflow-hidden">
              <div className="w-5 h-5 bg-primary rounded flex items-center justify-center text-[8px] font-black text-white shrink-0 shadow-sm shadow-primary/20">CST</div>
              <span className="text-[12px] font-bold text-slate-800 uppercase tracking-tighter whitespace-nowrap">FlowDesk</span>
            </Link>
            <button onClick={() => setIsCollapsed(true)} className="p-1 hover:bg-slate-50 rounded text-slate-400 transition-colors">
              <ChevronLeft size={14} />
            </button>
          </>
        ) : (
          <Link href="/" className="mx-auto block" onClick={() => setIsCollapsed(false)}>
            <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-[11px] font-black text-white shadow-md shadow-primary/20 hover:scale-105 active:scale-95 transition-all">CST</div>
          </Link>
        )}
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-0.5 styled-scroll mt-1">
        {!isCollapsed ? (
          <>
            <Link href="/" className={`left-nav-item ${isActive("/") ? "active" : ""}`}>
              <Compass size={14} /> <span>Explore</span>
            </Link>
            <Link href="/accounts" className={`left-nav-item ${isActive("/accounts") ? "active" : ""}`}>
              <Building2 size={14} /> <span>Accounts</span>
            </Link>

            <div className="mt-1">
              <button onClick={() => setAiAppsOpen(!aiAppsOpen)} className={`left-nav-item w-full ${isAiAppActive ? "active" : ""}`}>
                <Sparkles size={14} /> <span className="flex-1 text-left">AI Intelligence</span>
                <ChevronDown size={12} className={`transition-transform duration-200 ${aiAppsOpen ? "rotate-180" : ""}`} />
              </button>
              {aiAppsOpen && !isCollapsed && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  {aiApps.map(app => {
                    const active = isActive(app.href);
                    return (
                      <Link 
                        key={app.id} 
                        href={app.href} 
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 ${active ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full transition-all ${active ? "bg-primary scale-100" : "bg-transparent scale-0"}`} />
                        {ICON_MAP[app.icon ?? ""] || <Sparkles size={12} />}
                        <span>{app.name}</span>
                      </Link>
                    );
                  })}
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
                <div className="px-3 mb-2 text-[10px] font-black uppercase text-slate-400 tracking-widest opacity-60">Administration</div>
                <Link href="/admin" className={`left-nav-item ${isActive("/admin") ? "active" : ""}`}>
                  <LayoutDashboard size={14} /> <span>Admin Console</span>
                </Link>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 pt-1">
            <Link href="/" className={`p-2.5 rounded-xl transition-all ${isActive("/") ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`} title="Explore"><Compass size={20}/></Link>
            <Link href="/accounts" className={`p-2.5 rounded-xl transition-all ${isActive("/accounts") ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`} title="Accounts"><Building2 size={20}/></Link>
            
            <div className="relative group/mini">
              <button onClick={() => { setIsCollapsed(false); setAiAppsOpen(true); }} className={`p-2.5 rounded-xl transition-all ${isAiAppActive ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`} title="AI Intelligence">
                <Sparkles size={20}/>
              </button>
            </div>

            <Link href="/tasks" className={`p-2.5 rounded-xl transition-all ${isTasksActive ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`} title="Tasks"><Zap size={20}/></Link>
            
            {session?.user?.role === "admin" && (
              <div className="mt-4 pt-4 border-t border-slate-50 flex flex-col items-center gap-2">
                <Link href="/admin" className={`p-2.5 rounded-xl transition-all ${isActive("/admin") ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"}`} title="Admin Console"><LayoutDashboard size={20}/></Link>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t mt-auto">
         {!isCollapsed ? (
           <button onClick={() => setIsCollapsed(true)} className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-bold text-slate-400 hover:bg-slate-50 hover:text-slate-600 rounded-lg transition-all group">
              <span className="opacity-0 group-hover:opacity-100 transition-opacity">Collapse</span>
              <ChevronLeft size={14} className="group-hover:-translate-x-0.5 transition-transform" />
           </button>
         ) : (
           <button onClick={() => setIsCollapsed(false)} className="w-10 h-10 mx-auto flex items-center justify-center text-slate-300 hover:text-primary hover:bg-primary/5 rounded-xl transition-all">
              <ChevronRight size={18} />
           </button>
         )}
      </div>
    </aside>
  );
}
