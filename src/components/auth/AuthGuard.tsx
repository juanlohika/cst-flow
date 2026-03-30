"use client";

// Auth guard disabled — all users pass through without login.
export default function AuthGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
