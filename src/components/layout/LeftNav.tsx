"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
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
}

/**
 * LeftNav: Permanent Sidebar Navigation.
 * Now using ForceLink for indestructible navigation logic.
 */
export default function LeftNav({ initialApps, user }: LeftNavProps) {
  const pathname = usePathname();
  
  // High-Fidelity Initial State
  const isInsideAiApp = initialApps.some(a => pathname?.startsWith(a.href));
  
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(isInsideAiApp);

  // Sync open state when navigating to a sub-app via external link or back button
  useEffect(() => {
    if (isInsideAiApp) setAiAppsOpen(true);
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
            <ForceLink href="/" className="flex items-center gap-2">
              <div className="w-5 h-5 bg-primary rounded flex items-center justify-center text-[8px] font-black text-white shrink-0 shadow-sm shadow-primary/20">CST</div>
              <span className="text-[12px] font-bold text-slate-800 uppercase tracking-tighter whitespace-nowrap">FlowDesk</span>
            </ForceLink>
            <button onClick={() => setIsCollapsed(true)} className="p-1 hover:bg-slate-50 rounded text-slate-400">
              <ChevronLeft size={14} />
            </button>
          </>
        ) : (
          <button className="mx-auto block" onClick={() => setIsCollapsed(false)}>
            <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-[11px] font-black text-white shadow-md shadow-primary/20">CST</div>
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

            <ForceLink href="/tasks" className={`left-nav-item mt-1 ${isActive("/tasks") ? "active" : ""}`}>
              <Zap size={14} /> <span>Tasks</span>
            </ForceLink>

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

      <div className="p-2 border-t mt-auto">
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="w-full flex items-center justify-center p-2 text-slate-400 hover:text-primary hover:bg-slate-50 rounded-lg transition-colors">
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
