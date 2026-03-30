"use client";

import React from "react";
import { Bell } from "lucide-react";
import UserButton from "@/components/auth/UserButton";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";

interface GlobalBarProps {
  breadcrumbs?: { label: string; href?: string }[];
  actions?: React.ReactNode;
}

export default function GlobalBar({ 
  breadcrumbs: propBreadcrumbs, 
  actions: propActions 
}: GlobalBarProps) {
  const { breadcrumbs: contextBreadcrumbs, actions: contextActions } = useBreadcrumbs();
  
  // Use props if provided, otherwise context
  const breadcrumbs = propBreadcrumbs || contextBreadcrumbs;
  const actions = propActions || contextActions;

  return (
    <div className="nav-bar sticky top-0 z-40">
      {/* Left: Breadcrumb */}
      <div className="nav-bar-left">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="hidden sm:flex items-center gap-1.5">
            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={idx}>
                {idx > 0 && <span className="text-text-secondary text-xs">/</span>}
                {crumb.href ? (
                  <a href={crumb.href} className="text-xs font-medium text-primary hover:underline">{crumb.label}</a>
                ) : (
                  <span className="text-xs font-semibold text-text-primary">{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
      </div>

      {/* Right: custom actions + bell + profile */}
      <div className="nav-bar-right">
        {actions}
        <button
          className="p-1.5 rounded-md hover:bg-surface-muted transition-colors text-text-secondary hover:text-text-primary relative"
          title="Notifications"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>
        <UserButton />
      </div>
    </div>
  );
}
