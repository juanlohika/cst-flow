"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ChevronLeft, ChevronRight, ChevronDown,
  Compass, GitBranch, FileText, Clock, Zap,
  ShieldCheck, Settings, Building2, CalendarCheck,
  Paintbrush, LayoutGrid, FolderOpen, EyeOff, Eye,
  Archive, LayoutDashboard, Sparkles,
} from "lucide-react";

// ── Icon map for DB-driven apps ──────────────────────────────────
const ICON_MAP: Record<string, React.ReactNode> = {
  CalendarCheck: <CalendarCheck className="w-3 h-3" />,
  GitBranch:     <GitBranch     className="w-3 h-3" />,
  FileText:      <FileText      className="w-3 h-3" />,
  Paintbrush:    <Paintbrush    className="w-3 h-3" />,
  Clock:         <Clock         className="w-3 h-3" />,
  Sparkles:      <Sparkles      className="w-3 h-3" />,
};

const ADMIN_ITEMS = [
  { id: "admin",    label: "Admin",    href: "/admin",    icon: <ShieldCheck className="w-3.5 h-3.5" /> },
];

export default function LeftNav() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [aiAppsOpen, setAiAppsOpen] = useState(false);
  const [aiApps, setAiApps] = useState<{ id: string; name: string; slug: string; href: string; icon: string | null }[]>([]);
  const [taskProjects, setTaskProjects] = useState<any[]>([]);
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState<string>("DASHBOARD");
  const [bottomLogo, setBottomLogo] = useState<string | null>(null);
  const [appName, setAppName] = useState<string>("Team OS");
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const { data: session, status } = useSession();

  const isAiAppActive = aiApps.some(a => pathname?.startsWith(a.href));
  const isTasksActive = pathname?.startsWith("/tasks") ?? false;
  
  useEffect(() => setMounted(true), []);

  // Load AI apps from DB once
  useEffect(() => {
    fetch("/api/apps")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setAiApps(data.filter((a: any) => a.isActive && a.slug !== "meeting-prep")); })
      .catch(() => {});

    // Load global settings
    fetch("/api/admin/settings")
      .then(r => r.json())
      .then(data => {
        if (data.bottom_logo_url) setBottomLogo(data.bottom_logo_url);
        if (data.app_name) setAppName(data.app_name);
      })
      .catch(() => {});
  }, []);


  // Auto-expand AI Apps group when on any AI app route
  useEffect(() => {
    if (isAiAppActive) setAiAppsOpen(true);
  }, [isAiAppActive]);

  // Read active project from URL after mount / navigation
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const proj = params.get("project");
    setActiveProjectId(proj ? proj : pathname?.startsWith("/tasks") ? "DASHBOARD" : "ALL");
  }, [pathname]);

  // Fetch projects when entering tasks section
  useEffect(() => {
    if (isTasksActive && taskProjects.length === 0) {
      fetch("/api/projects")
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            setTaskProjects(data.filter((p: any) => p.templateType !== "account-maintenance"));
          }
        })
        .catch(() => {});
    }
  }, [isTasksActive]);

  // Load hidden projects from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("tasks-sidebar-hidden");
      if (stored) setHiddenProjects(new Set(JSON.parse(stored)));
    } catch {}
  }, []);

  const toggleHide = (projectId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(hiddenProjects);
    if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
    setHiddenProjects(next);
    try { localStorage.setItem("tasks-sidebar-hidden", JSON.stringify(Array.from(next))); } catch {}
  };

  if (status === "loading") return null;
  if (!session) return null;

  const visibleAdminItems = (session.user as any)?.role === "admin" ? ADMIN_ITEMS : [];
  const visibleProjects = taskProjects.filter(p => !hiddenProjects.has(p.id));
  const hiddenProjectList = taskProjects.filter(p => hiddenProjects.has(p.id));

  const isActive = (href: string) => {
    if (!mounted) return false;
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  if (isCollapsed) {
    return (
      <div className="left-nav collapsed">
        <button onClick={() => setIsCollapsed(false)} className="p-3 hover:bg-surface-muted transition-colors" title="Expand navigation">
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </button>
      </div>
    );
  }

  return (
    <nav className="left-nav">
      {/* Header */}
      <div className="left-nav-header">
        <Link href="/" className="left-nav-logo bg-white p-1 rounded-lg">
          <img 
            src="https://www.tarkie.com/wp-content/uploads/2025/09/tarkie-logo-navbar.svg" 
            alt={appName || "Tarkie"} 
            className="h-6 w-auto object-contain"
          />
        </Link>
        <button onClick={() => setIsCollapsed(true)} className="p-1 rounded-md hover:bg-surface-muted transition-colors" title="Collapse navigation">
          <ChevronLeft className="w-4 h-4 text-text-muted" />
        </button>
      </div>


      {/* Nav Items */}
      <div className="left-nav-items styled-scroll">

        {/* Explore */}
        <Link
          href="/"
          className={`left-nav-item ${isActive("/") ? "active" : ""}`}
          title="Explore"
        >
          <Compass className="w-3.5 h-3.5" />
          <span>Explore</span>
        </Link>

        {/* Accounts */}
        <Link
          href="/accounts"
          className={`left-nav-item ${isActive("/accounts") ? "active" : ""}`}
          title="Accounts"
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Accounts</span>
        </Link>

        {/* AI Apps group */}
        <div>
          <button
            onClick={() => setAiAppsOpen(o => !o)}
            className={`left-nav-item w-full text-left ${isAiAppActive ? "active" : ""}`}
            title="AI Apps"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span className="flex-1">AI Apps</span>
            <ChevronDown
              className={`w-3 h-3 text-text-muted transition-transform duration-200 ${aiAppsOpen ? "rotate-180" : ""}`}
            />
          </button>

          {aiAppsOpen && (
            <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-slate-100 pl-2">
              {aiApps.map(item => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                    isActive(item.href)
                      ? "text-primary bg-primary/5"
                      : "text-text-secondary hover:bg-surface-muted"
                  }`}
                >
                  {ICON_MAP[item.icon ?? ""] ?? <Sparkles className="w-3.5 h-3.5" />}
                  <span>{item.name.toLowerCase() === "brd maker" ? "BRD Maker" : item.name.replace(/\b\w/g, l => l.toUpperCase())}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Tasks (with project submenu) */}
        <div>
          <Link
            href="/tasks"
            className={`left-nav-item ${isTasksActive ? "active" : ""}`}
            title="Tasks"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Tasks</span>
          </Link>

          {isTasksActive && (
            <div className="ml-3 mt-0.5 mb-1 space-y-0.5 border-l border-slate-100 pl-2">
              {/* My Dashboard */}
              <Link
                href="/tasks"
                className={`flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                  activeProjectId === "DASHBOARD" ? "text-primary bg-primary/5" : "text-text-secondary hover:bg-surface-muted"
                }`}
              >
                <LayoutDashboard className="w-2.5 h-2.5 shrink-0" />
                <span>My Dashboard</span>
              </Link>
              {/* All Projects */}
              <Link
                href="/tasks?project=ALL"
                className={`flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${
                  activeProjectId === "ALL" ? "text-primary bg-primary/5" : "text-text-secondary hover:bg-surface-muted"
                }`}
              >
                <LayoutGrid className="w-2.5 h-2.5 shrink-0" />
                <span>All Projects</span>
              </Link>

              {/* Visible projects */}
              {visibleProjects.map(p => (
                <div key={p.id} className="group flex items-center gap-0.5">
                  <Link
                    href={`/tasks?project=${p.id}`}
                    className={`flex-1 flex items-center gap-2 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest truncate transition-all ${
                      activeProjectId === p.id ? "text-primary bg-primary/5" : "text-text-secondary hover:bg-surface-muted"
                    }`}
                  >
                    <FolderOpen className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </Link>
                  <button
                    onClick={e => toggleHide(p.id, e)}
                    title="Hide from sidebar"
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-text-secondary hover:text-amber-500 transition-all rounded"
                  >
                    <EyeOff className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}

              {/* Hidden projects toggle */}
              {hiddenProjectList.length > 0 && (
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className="flex items-center gap-1.5 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-text-secondary opacity-50 hover:opacity-100 transition-all w-full"
                >
                  <Archive className="w-2 h-2 shrink-0" />
                  {showHidden ? "Hide archived" : `${hiddenProjectList.length} archived`}
                </button>
              )}

              {showHidden && hiddenProjectList.map(p => (
                <div key={p.id} className="group flex items-center gap-0.5 opacity-40 hover:opacity-100 transition-all">
                  <span className="flex-1 flex items-center gap-2 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-text-secondary truncate">
                    <FolderOpen className="w-2.5 h-2.5 shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <button
                    onClick={e => toggleHide(p.id, e)}
                    title="Restore"
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-primary transition-all rounded"
                  >
                    <Eye className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Admin / Settings (admin only) */}
        {visibleAdminItems.length > 0 && (
          <>
            <div className="h-px bg-border-default my-2" />
            {visibleAdminItems.map(item => (
              <Link
                key={item.id}
                href={item.href}
                className={`left-nav-item ${isActive(item.href) ? "active" : ""}`}
                title={item.label}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="left-nav-footer">
        {bottomLogo ? (
          <div className="w-full flex items-center justify-center p-2">
            <img 
              src={bottomLogo} 
              alt={appName} 
              className="max-h-12 w-auto object-contain opacity-80 hover:opacity-100 transition-opacity" 
            />
          </div>
        ) : (
          <div className="w-full h-10 bg-surface-muted rounded-md flex items-center justify-center text-text-secondary text-[10px] font-black uppercase tracking-widest opacity-40">
            {appName}
          </div>
        )}
      </div>

    </nav>
  );
}
