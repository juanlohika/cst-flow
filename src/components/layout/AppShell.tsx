"use client";

import React, { useState, useEffect } from "react";
import LeftNav from "./LeftNav";
import GlobalBar from "./GlobalBar";
import { BreadcrumbProvider } from "@/lib/contexts/BreadcrumbContext";

interface AppShellProps {
  children: React.ReactNode;
  initialApps: any[];
  user: any;
}

/**
 * AppShell: The IDE-style structural shell for CST FlowDesk.
 * STABILITY FIX: This is a persistent Client Component that DOES NOT unmount 
 * during Next.js page transitions within the (app) group.
 */
export default function AppShell({ children, initialApps, user }: AppShellProps) {
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.ok ? r.json() : {})
      .then(setSettings)
      .catch(() => setSettings({}));
  }, []);

  return (
    <BreadcrumbProvider>
      <div className="page-shell bg-surface-subtle">
        {user && (
          <LeftNav 
            initialApps={initialApps} 
            user={user} 
            settings={settings}
          />
        )}
        
        <main className={user ? "page-content" : "page-content-full"}>
          <GlobalBar />
          <div className="flex-1 overflow-auto bg-white shadow-inner-top relative flex flex-col min-h-0">
            {children}
          </div>
        </main>
      </div>
    </BreadcrumbProvider>
  );
}
