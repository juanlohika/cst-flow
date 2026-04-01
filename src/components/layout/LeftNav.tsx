"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Compass, GitBranch, FileText, Clock, Zap,
  ShieldCheck, Settings, Building2, CalendarCheck,
  Paintbrush, LayoutGrid, FolderOpen, EyeOff, Eye,
  Archive, LayoutDashboard, Sparkles
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  CalendarCheck: <CalendarCheck size={14} />,
  GitBranch: <GitBranch size={14} />,
  FileText: <FileText size={14} />,
  Paintbrush: <Paintbrush size={14} />,
  Clock: <Clock size={14} />,
  Sparkles: <Sparkles size={14} />,
};

export default function LeftNav() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(false);
  const [aiApps, setAiApps] = useState<any[]>([]);
  const [taskProjects, setTaskProjects] = useState<any[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>("DASHBOARD");
  const [appName, setAppName] = useState<string>("FlowDesk");
  const [mounted, setMounted] = useState(false);

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const hoverTimeout = useRef<NodeJS.Timeout | null>(null);

  const isFocusPage = pathname?.startsWith("/architect") || pathname?.startsWith("/brd") || pathname?.startsWith("/timeline") || pathname?.startsWith("/admin");
  const isAiAppActive = aiApps.some(a => pathname?.startsWith(a.href));
  const isTasksActive = pathname?.startsWith("/tasks") ?? false;

  useEffect(() => {
    setMounted(true);
    // Initial auto-collapse on page entry
    if (isFocusPage) setIsCollapsed(true);
  }, []);

  // Sync isCollapsed with Global Layout via simple CSS variable injection
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nav-width", isCollapsed ? "72px" : "255px");
  }, [isCollapsed]);

  const handleMouseEnter = () => {
    if (!isCollapsed) return;
    hoverTimeout.current = setTimeout(() => setIsHovered(true), 400); // Smooth 400ms delay per user request
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

  useEffect(() => {
    if (isAiAppActive && (!isCollapsed || isHovered)) setAiAppsOpen(true);
  }, [isAiAppActive, isCollapsed, isHovered]);

  useEffect(() => {
    const proj = searchParams?.get("project");
    setActiveProjectId(proj ? proj : pathname?.startsWith("/tasks") ? "DASHBOARD" : "ALL");
  }, [pathname, searchParams]);

  if (!session) return null;

  const isActive = (href: string) => {
    if (!mounted) return false;
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  const sidebarWidth = isCollapsed && !isHovered ? 72 : 255;
  const isFloating = isCollapsed && isHovered;

  return (
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`left-nav ${isCollapsed && !isHovered ? "collapsed" : ""} ${isFloating ? "shadow-2xl border-r-blue-500/20" : ""}`}
      style={{ 
        width: sidebarWidth,
        position: 'fixed',
        left: 0,
        top: 0,
        bottom: 0,
        backgroundColor: 'white',
        zIndex: 9999,
        transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)'
      }}
    >
      {/* Header */}
      <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
        {(!isCollapsed || isHovered) ? (
          <>
            <Link href="/" className="flex items-center gap-2">
              <div className="w-5 h-5 bg-primary rounded flex items-center justify-center text-[8px] font-black text-white">CST</div>
              <span className="text-[12px] font-bold text-slate-800 uppercase tracking-tighter">{appName}</span>
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-0.5 styled-scroll">
        {(!isCollapsed || isHovered) ? (
          <>
            <Link href="/" className={`left-nav-item ${isActive("/") ? "active" : ""}`}>
              <Compass size={14} /> <span>Explore</span>
            </Link>
            <Link href="/accounts" className={`left-nav-item ${isActive("/accounts") ? "active" : ""}`}>
              <Building2 size={14} /> <span>Accounts</span>
            </Link>

            <div className="mt-1">
              <button 
                onClick={() => setAiAppsOpen(!aiAppsOpen)} 
                className={`left-nav-item w-full ${isAiAppActive ? "active" : ""}`}
              >
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
              {isTasksActive && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                   <Link href="/tasks" className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 rounded-md">
                     <LayoutDashboard size={12}/> <span>Dashboard</span>
                   </Link>
                   <div className="px-2 py-1 text-[9px] font-black uppercase text-slate-300">Contextual</div>
                   {taskProjects.slice(0, 3).map(p => (
                      <Link key={p.id} href={`/tasks?project=${p.id}`} className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50 rounded-md">
                        <FolderOpen size={12}/> <span className="truncate">{p.name}</span>
                      </Link>
                   ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Link href="/" className={`p-2 rounded-md ${isActive("/") ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Explore"><Compass size={18}/></Link>
            <Link href="/accounts" className={`p-2 rounded-md ${isActive("/accounts") ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Accounts"><Building2 size={18}/></Link>
            <Link href="/tasks" className={`p-2 rounded-md ${isTasksActive ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="Tasks"><Zap size={18}/></Link>
            <div className="h-px w-6 bg-slate-100 my-1" />
            <button onClick={() => setIsCollapsed(false)} className={`p-2 rounded-md ${isAiAppActive ? "bg-primary/5 text-primary" : "text-slate-400 hover:bg-slate-50"}`} title="AI Hub"><Sparkles size={18}/></button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t mt-auto">
         {(!isCollapsed || isHovered) ? (
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
    </aside>
  );
}
