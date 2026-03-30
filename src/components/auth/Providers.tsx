"use client";

import { SessionProvider } from "next-auth/react";

export default function Providers({ children }: { children: React.ReactNode }) {
  const demoSession = {
    user: {
      id: "mock-admin-id",
      name: "CST Admin (Demo)",
      email: "admin@cst.com",
      role: "admin"
    },
    expires: new Date(Date.now() + 3600 * 1000).toISOString()
  };

  return (
    <SessionProvider session={demoSession as any}>
      {children}
    </SessionProvider>
  );
}
