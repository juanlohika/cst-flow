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
  // We keep the sidebar session-aware but structurally static.
  // This ensures that the 200ms "Dead Click" window is eliminated 
  // because the JS is already hydrated and doesn't need to rebuild 
  // the DOM on every navigation.
  
  return (
    <BreadcrumbProvider>
      <div className="page-shell bg-surface-subtle">
        {user && (
          <LeftNav 
            initialApps={initialApps} 
            user={user} 
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
