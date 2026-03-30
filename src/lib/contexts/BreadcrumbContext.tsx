"use client";

import React, { createContext, useContext, useState, ReactNode } from "react";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextType {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (breadcrumbs: Breadcrumb[]) => void;
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextType | undefined>(undefined);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [actions, setActions] = useState<ReactNode>(null);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs, actions, setActions }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs(newBreadcrumbs?: Breadcrumb[], newActions?: ReactNode) {
  const context = useContext(BreadcrumbContext);
  if (!context) {
    throw new Error("useBreadcrumbs must be used within a BreadcrumbProvider");
  }

  React.useEffect(() => {
    if (newBreadcrumbs) {
      context.setBreadcrumbs(newBreadcrumbs);
    }
    if (newActions !== undefined) {
      context.setActions(newActions);
    }
    // Cleanup on unmount
    return () => {
      // We don't necessarily want to clear it immediately on every re-render,
      // but on major page changes. Next.js page transitions will handle this via layout.
    };
  }, [newBreadcrumbs, newActions]);

  return context;
}
