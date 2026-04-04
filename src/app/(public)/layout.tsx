"use client";

import React from "react";

/**
 * Public Layout: Universal clean container for public pages.
 * NO AppShell, NO Sidebar, NO Header.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col antialiased">
      {children}
    </div>
  );
}
