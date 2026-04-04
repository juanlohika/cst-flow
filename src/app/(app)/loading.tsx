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

  const logoUrl = settings?.app_logo || settings?.bottom_logo_url;
  const brandName = settings?.app_name || "FlowDesk";

  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-screen bg-white">
      {logoUrl ? (
        <img 
          src={logoUrl} 
          alt={brandName} 
          className="h-10 w-auto mb-6 animate-pulse object-contain" 
        />
      ) : (
        <div className="text-2xl font-black text-primary mb-6 tracking-tighter uppercase">{brandName}</div>
      )}
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        <span className="text-[10px] font-black tracking-widest uppercase opacity-70">
          Loading {brandName}
        </span>
      </div>
    </div>
  );
}
