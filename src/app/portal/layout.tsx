import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "ARIMA — Client Portal",
  description: "Your direct line to the CST team.",
  manifest: "/arima-portal-manifest.json",
  // PWA-friendly settings so "Add to Home Screen" works nicely
  appleWebApp: {
    capable: true,
    title: "ARIMA",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0177b5",
};

/**
 * Minimal layout for the public portal — no CST OS chrome, no left nav.
 * Lives outside the (app) route group so AppShell doesn't wrap it.
 */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F0F4FC] via-white to-white">
      {children}
    </div>
  );
}
