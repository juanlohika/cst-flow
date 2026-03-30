"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function Loading() {
  const [settings, setSettings] = useState<any>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(r => r.ok ? r.json() : {})
      .then(setSettings)
      .catch(() => setSettings({}));
  }, []);

  const logoUrl = settings?.company_logo || "/tarkie-full-dark.png";
  const brandName = settings?.company_name || settings?.app_name || "Tarkie";

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
      <img 
        src={logoUrl} 
        alt={brandName} 
        className="h-8 w-auto mb-4 animate-pulse object-contain" 
      />
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-[11px] font-medium tracking-wide uppercase">
          Initialising {brandName}...
        </span>
      </div>
    </div>
  );
}
