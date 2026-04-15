"use client";

import { useSession, signOut } from "next-auth/react";
import { useState, useRef, useEffect } from "react";
import { LogOut, User, ChevronDown, ShieldCheck } from "lucide-react";

export default function UserButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Calculate fixed position when opening so dropdown is never clipped
  const handleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(o => !o);
  };

  if (status === "loading") {
    return <div className="h-8 w-8 bg-surface-muted animate-pulse rounded-full" />;
  }

  if (!session?.user) {
    return (
      <button 
        onClick={() => (window.location.href = "/auth/signin")}
        className="px-4 py-2 bg-primary text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-primary/90 transition-all flex items-center gap-2"
      >
        Sign In
      </button>
    );
  }

  const name = session.user.name || session.user.email || "User";
  const email = session.user.email || "";
  const initial = name[0].toUpperCase();
  const role = (session.user as any).role || "user";

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        onClick={handleOpen}
        className="flex items-center gap-2 h-8 px-2 rounded-xl hover:bg-surface-muted transition-colors"
      >
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-white text-[11px] font-black shrink-0">
          {session.user.image ? (
            <img src={session.user.image} alt={name} className="w-7 h-7 rounded-full object-cover" />
          ) : initial}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="fixed w-64 bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-100 z-[9999] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
          style={{ top: dropdownPos.top, right: dropdownPos.right }}
        >
          {/* User info */}
          <div className="px-4 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-white text-sm font-black shrink-0">
                {session.user.image ? (
                  <img src={session.user.image} alt={name} className="w-10 h-10 rounded-full object-cover" />
                ) : initial}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-800 truncate">{name}</p>
                <p className="text-[11px] text-slate-400 truncate">{email}</p>
                <div className="flex items-center gap-1 mt-1">
                  {role === "admin" ? (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      <ShieldCheck className="w-2.5 h-2.5" /> Admin
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                      <User className="w-2.5 h-2.5" /> Member
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="p-2">
            <button
              onClick={() => { setOpen(false); signOut({ callbackUrl: "/" }); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
