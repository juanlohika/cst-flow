"use client";

import React, { useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import ForceLink from "@/components/ui/ForceLink";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Compass, Zap, Building2, Sparkles, LayoutDashboard
} from "lucide-react";

const ICON_MAP: Record<string, React.ReactNode> = {
  Sparkles: <Sparkles size={14} />,
};

interface LeftNavProps {
  initialApps: any[];
  user: any;
  settings?: any;
}

/**
 * LeftNav: Permanent Sidebar Navigation.
 * Now using ForceLink for indestructible navigation logic.
 * Dynamic Branding: Uses logo/name from Admin settings.
 */
export default function LeftNav({ initialApps, user, settings }: LeftNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeProjectId = searchParams.get("project");
  
  const logoUrl = settings?.app_logo || settings?.bottom_logo_url;
  const brandName = settings?.app_name || "FlowDesk";

  // High-Fidelity Initial State
  const isInsideAiApp = initialApps.some(a => pathname?.startsWith(a.href));
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(isInsideAiApp);
  const [tasksOpen, setTasksOpen] = useState(pathname?.startsWith("/tasks"));
  const [projects, setProjects] = useState<any[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Global Data Fetch: Projects for Sidebar
  useEffect(() => {
    if (!user) return;
    setProjectsLoading(true);
    fetch("/api/projects")
      .then(r => r.ok ? r.json() : { projects: [] })
      .then(data => setProjects(Array.isArray(data.projects) ? data.projects : []))
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoading(false));
  }, [user]);

  // Sync open state when navigating
  useEffect(() => {
    if (isInsideAiApp) setAiAppsOpen(true);
    if (pathname?.startsWith("/tasks")) setTasksOpen(true);
  }, [pathname, isInsideAiApp]);

  if (!user) return null;

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  const sidebarWidth = isCollapsed ? 64 : 240;

  return (
    <aside
      className="left-nav flex-shrink-0 flex flex-col bg-white border-r border-slate-200 transition-[width] duration-300 ease-in-out"
      style={{ width: sidebarWidth }}
    >
      {/* Brand Header */}
      <div className="h-10 border-b flex items-center justify-between px-3 shrink-0">
        {!isCollapsed ? (
          <>
            <ForceLink href="/" className="flex items-center gap-2 overflow-hidden">
              <span className="text-[12px] font-black text-slate-900 uppercase tracking-tighter whitespace-nowrap truncate">{brandName}</span>
            </ForceLink>
            <button onClick={() => setIsCollapsed(true)} className="p-1 hover:bg-slate-50 rounded text-slate-400">
              <ChevronLeft size={14} />
            </button>
          </>
        ) : (
          <button className="mx-auto block p-1 text-slate-400 hover:text-primary" onClick={() => setIsCollapsed(false)}>
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-0.5 styled-scroll mt-1">
        {!isCollapsed ? (
          <>
            <ForceLink href="/" className={`left-nav-item ${isActive("/") ? "active" : ""}`}>
              <Compass size={14} /> <span>Explore</span>
            </ForceLink>
            <ForceLink href="/accounts" className={`left-nav-item ${isActive("/accounts") ? "active" : ""}`}>
              <Building2 size={14} /> <span>Accounts</span>
            </ForceLink>

            <div className="mt-1">
              <button 
                onClick={() => setAiAppsOpen(!aiAppsOpen)} 
                className={`left-nav-item w-full ${aiAppsOpen ? "bg-slate-50" : ""}`}
              >
                <Sparkles size={14} className={isInsideAiApp ? "text-primary" : "text-slate-400"} /> 
                <span className={`flex-1 text-left ${isInsideAiApp ? "font-bold text-slate-900" : ""}`}>AI Intelligence</span>
                <ChevronDown size={12} className={`transition-transform duration-200 ${aiAppsOpen ? "rotate-180" : ""}`} />
              </button>
              
              {aiAppsOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                  {initialApps.map(app => {
                    const active = isActive(app.href);
                    return (
                      <ForceLink 
                        key={app.id} 
                        href={app.href} 
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${active ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${active ? "bg-primary" : "bg-transparent"}`} />
                        {ICON_MAP[app.icon ?? ""] || <Sparkles size={12} />}
                        <span>{app.name}</span>
                      </ForceLink>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-1">
              <div className="flex items-center">
                <ForceLink 
                  href="/tasks" 
                  className={`flex-1 left-nav-item !mr-0 ${isActive("/tasks") && !activeProjectId ? "active" : ""}`}
                >
                  <Zap size={14} /> <span>Tasks</span>
                </ForceLink>
                <button 
                  onClick={(e) => { e.preventDefault(); setTasksOpen(!tasksOpen); }}
                  className={`p-1.5 hover:bg-slate-100 rounded text-slate-400 transition-transform duration-200 ${tasksOpen ? "rotate-180" : ""}`}
                >
                  <ChevronDown size={12} />
                </button>
              </div>

              {tasksOpen && (
                <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-100 pl-2">
                  <ForceLink 
                    href="/tasks" 
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${isActive("/tasks") && !activeProjectId ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50"}`}
                  >
                    <LayoutDashboard size={12} />
                    <span>My Dashboard</span>
                  </ForceLink>

                  <ForceLink 
                    href="/tasks?project=ALL" 
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${activeProjectId === "ALL" ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${activeProjectId === "ALL" ? "bg-primary" : "bg-slate-200"}`} />
                    <span>All Projects</span>
                  </ForceLink>
                  
                  <ForceLink 
                    href="/tasks?project=ARCHIVE" 
                    className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${activeProjectId === "ARCHIVE" ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                  >
                    <div className={`w-1.5 h-1.5 rounded-full ${activeProjectId === "ARCHIVE" ? "bg-primary" : "bg-slate-200"}`} />
                    <span className="flex-1">Archived Roadmaps</span>
                    <div className="text-[9px] font-black opacity-30 px-1.5 py-0.5 border border-slate-200 rounded uppercase tracking-tighter">Library</div>
                  </ForceLink>
                  
                  <div className="py-1 px-2 text-[9px] font-black uppercase text-slate-300 tracking-widest mt-2 border-t border-slate-50 pt-2">Individual Roadmaps</div>
                  
                  {projectsLoading ? (
                    <div className="px-2 py-1 text-[10px] text-slate-300 animate-pulse uppercase font-bold tracking-widest">Loading Projects…</div>
                  ) : projects.filter(p => !p.archived).length === 0 ? (
                    <div className="px-2 py-1 text-[10px] text-slate-300 uppercase font-bold tracking-widest">No active roadmaps</div>
                  ) : projects.filter(p => !p.archived).map(p => {
                    const projectHref = `/tasks?project=${p.id}`;
                    const active = activeProjectId === p.id;
                    return (
                      <ForceLink 
                        key={p.id} 
                        href={projectHref} 
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors ${active ? "text-primary bg-primary/10 font-bold" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"}`}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${active ? "bg-primary" : "bg-slate-200"}`} />
                        <span className="truncate">{p.name}</span>
                      </ForceLink>
                    );
                  })}
                </div>
              )}
            </div>

            {user.role === "admin" && (
              <div className="mt-4 border-t pt-2">
                <div className="px-3 mb-1 text-[10px] font-black uppercase text-slate-400 tracking-widest opacity-60">Admin</div>
                <ForceLink href="/admin" className={`left-nav-item ${isActive("/admin") ? "active" : ""}`}>
                  <LayoutDashboard size={14} /> <span>Console</span>
                </ForceLink>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 pt-1">
            <ForceLink href="/" className={`p-2.5 rounded-xl ${isActive("/") ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-100"}`} title="Explore"><Compass size={20}/></ForceLink>
            <ForceLink href="/accounts" className={`p-2.5 rounded-xl ${isActive("/accounts") ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-100"}`} title="Accounts"><Building2 size={20}/></ForceLink>
            <button onClick={() => { setIsCollapsed(false); setAiAppsOpen(true); }} className={`p-2.5 rounded-xl ${isInsideAiApp ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-100"}`} title="AI Intelligence"><Sparkles size={20}/></button>
            <ForceLink href="/tasks" className={`p-2.5 rounded-xl ${isActive("/tasks") ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-100"}`} title="Tasks"><Zap size={20}/></ForceLink>
            {user.role === "admin" && (
              <ForceLink href="/admin" className={`p-2.5 rounded-xl mt-4 pt-4 border-t ${isActive("/admin") ? "bg-primary text-white" : "text-slate-400 hover:bg-slate-100"}`} title="Admin"><LayoutDashboard size={20}/></ForceLink>
            )}
          </div>
        )}
      </div>

      {/* Bottom Branding (Logo) */}
      <div className="p-3 border-t mt-auto flex items-center justify-center">
        {logoUrl ? (
          <img 
            src={logoUrl} 
            alt={brandName} 
            className={`object-contain transition-all duration-300 ${isCollapsed ? "h-6" : "h-7"}`} 
          />
        ) : (
          <div className={`bg-primary rounded flex items-center justify-center font-black text-white shadow-sm transition-all duration-300 ${isCollapsed ? "w-6 h-6 text-[8px]" : "w-8 h-8 text-[10px]"}`}>
            {brandName.substring(0, 2).toUpperCase()}
          </div>
        )}
      </div>
    </aside>
  );
}
