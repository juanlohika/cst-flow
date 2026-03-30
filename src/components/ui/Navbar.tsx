"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { 
  ChevronLeft, 
  ChevronRight, 
  Search,
  LayoutGrid,
  GitBranch,
  FileText,
  Clock,
  Zap,
  ShieldCheck,
  Compass,
  Calendar as CalendarIcon
} from "lucide-react";

const APPS = [
  { id: "explore", label: "Explore", href: "/", icon: <Compass className="w-3.5 h-3.5" />, color: "text-blue-500" },
  { id: "architect", label: "Architect", href: "/architect", icon: <GitBranch className="w-3.5 h-3.5" />, color: "text-indigo-500" },
  { id: "brd", label: "BRD Maker", href: "/brd", icon: <FileText className="w-3.5 h-3.5" />, color: "text-emerald-500" },
  { id: "roadmap", label: "Roadmap", href: "/timeline", icon: <Clock className="w-3.5 h-3.5" />, color: "text-violet-500" },
  { id: "tasks", label: "Task Control", href: "/tasks", icon: <Zap className="w-3.5 h-3.5" />, color: "text-amber-500" },
  { id: "admin", label: "Admin", href: "/admin", icon: <ShieldCheck className="w-3.5 h-3.5" />, color: "text-slate-500" },
];

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft } = scrollRef.current;
      const scrollTo = direction === "left" ? scrollLeft - 150 : scrollLeft + 150;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: "smooth" });
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center max-w-4xl px-4">
      {!session ? (
        <nav className="flex items-center gap-8 text-[10px] font-black uppercase tracking-[0.2em]">
          <Link 
            href="/" 
            className={isActive("/") ? "text-primary border-b-2 border-primary pb-1" : "text-slate-400 hover:text-slate-900 transition-colors"}
          >
            Explore
          </Link>
          <Link 
            href="/solutions" 
            className={isActive("/solutions") ? "text-primary border-b-2 border-primary pb-1" : "text-slate-400 hover:text-slate-900 transition-colors"}
          >
            Solutions
          </Link>
        </nav>
      ) : (
        <div className="flex items-center gap-2 w-full overflow-hidden">
             {/* Left Arrow */}
             <button 
                onClick={() => scroll("left")}
                className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-300 transition-colors shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              {/* App Carousel */}
              <div 
                ref={scrollRef}
                className="flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap px-1"
              >
                {APPS.map((app) => (
                  <Link 
                    key={app.id} 
                    href={app.href}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all duration-300 border ${
                      isActive(app.href) 
                        ? "bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200" 
                        : "bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-100"
                    }`}
                  >
                    <div className={`${isActive(app.href) ? "text-white" : app.color} shrink-0`}>
                      {app.icon}
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest">{app.label}</span>
                  </Link>
                ))}
              </div>

              {/* Right Arrow */}
              <button 
                onClick={() => scroll("right")}
                className="p-1.5 hover:bg-slate-50 rounded-lg text-slate-300 transition-colors shrink-0"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
        </div>
      )}
    </div>
  );
}
