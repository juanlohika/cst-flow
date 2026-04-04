"use client";

import React, { useRef } from "react";
import { useRouter } from "next/navigation";

interface ForceLinkProps {
  href: string;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}

/**
 * ForceLink: Indestructible Navigation.
 * STABILITY FIX: If the Next.js router hangs or feels 'Dead', 
 * this component 'Forces' the browser to open the link after a short delay.
 */
export default function ForceLink({ href, className, children, onClick, title }: ForceLinkProps) {
  const router = useRouter();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const handleNavigate = (e: React.MouseEvent) => {
    // 1. Run any custom onClick logic first
    if (onClick) onClick();

    // 2. Prevent the default <a> behavior for a split second
    e.preventDefault();

    // 3. Start a 'Force' timer. If the router hasn't changed the page 
    // in 1500ms, we force a native browser navigation.
    // This is the absolute 'FORCE' the user requested.
    timerRef.current = setTimeout(() => {
      console.warn(`[ForceLink] Router hang detected for ${href}. FORCING NATIVE NAV.`);
      window.location.href = href;
    }, 1500);

    // 4. Try the smooth transition first
    console.log(`[ForceLink] Attempting smooth nav to ${href}`);
    router.push(href);
    
    // Note: If router.push works, the component will unmount and the timer clears.
  };

  // Cleanup on unmount (navigation success)
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <a 
      href={href} 
      className={className} 
      onClick={handleNavigate}
      title={title}
      style={{ cursor: 'pointer' }}
    >
      {children}
    </a>
  );
}
