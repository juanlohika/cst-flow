"use client";

import { useEffect, useState } from "react";

/**
 * ClientOnly: Prevents React Hydration Errors (#425 / #422).
 * 
 * Enforces that children are ONLY rendered on the client browser.
 * Use this to wrap any components that use locale-specific dates,
 * dynamic styles, or browser-only APIs (localStorage, window).
 */
export function ClientOnly({ children, fallback = null }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
