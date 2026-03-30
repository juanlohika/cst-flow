"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  Compass
} from "lucide-react";

const APPS = [
  { id: "explore", label: "Explore", href: "/", icon: <Compass className="w-4 h-4" />, color: "text-blue-500" },
  { id: "architect", label: "Architect", href: "/architect", icon: <GitBranch className="w-4 h-4" />, color: "text-indigo-500" },
  { id: "brd", label: "BRD Maker", href: "/brd", icon: <FileText className="w-4 h-4" />, color: "text-emerald-500" },
  { id: "roadmap", label: "Roadmap", href: "/timeline", icon: <Clock className="w-4 h-4" />, color: "text-violet-500" },
  { id: "tasks", label: "Task Control", href: "/tasks", icon: <Zap className="w-4 h-4" />, color: "text-amber-500" },
  { id: "admin", label: "Admin", href: "/admin", icon: <ShieldCheck className="w-4 h-4" />, color: "text-slate-500" },
];

export default function AppHeader() {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showSearch, setShowSearch] = useState(false);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const { scrollLeft, clientWidth } = scrollRef.current;
      const scrollTo = direction === "left" ? scrollLeft - 200 : scrollLeft + 200;
      scrollRef.current.scrollTo({ left: scrollTo, behavior: "smooth" });
    }
  };

  const isActive = (href: string) => {
    if (href === "/" && pathname === "/") return true;
    if (href !== "/" && pathname?.startsWith(href)) return true;
    return false;
  };

  return (
    <div className="w-full bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-4 sticky top-0 z-[50] shadow-sm">
      {/* Scroll Controls */}
      <button 
        onClick={() => scroll("left")}
        className="p-2 hover:bg-slate-50 rounded-lg text-slate-300 transition-colors shrink-0"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* App Carousel */}
      <div 
        ref={scrollRef}
        className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth whitespace-nowrap px-2"
      >
        {APPS.map((app) => (
          <Link 
            key={app.id} 
            href={app.href}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 border ${
              isActive(app.href) 
                ? "bg-slate-900 border-slate-900 text-white shadow-lg shadow-slate-200" 
                : "bg-white border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-100"
            }`}
          >
            <div className={`${isActive(app.href) ? "text-white" : app.color}`}>
              {app.icon}
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest">{app.label}</span>
          </Link>
        ))}
      </div>

      <button 
        onClick={() => scroll("right")}
        className="p-2 hover:bg-slate-50 rounded-lg text-slate-300 transition-colors shrink-0"
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <div className="h-6 w-px bg-slate-100 mx-2 shrink-0" />

      {/* Search Toggle */}
      <div className="flex items-center gap-2 shrink-0">
        {showSearch && (
          <input 
            autoFocus
            type="text"
            placeholder="Search Apps..."
            className="w-48 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-bold uppercase tracking-widest focus:ring-1 focus:ring-primary/20 transition-all animate-in slide-in-from-right-4"
            onBlur={() => setShowSearch(false)}
          />
        )}
        <button 
          onClick={() => setShowSearch(!showSearch)}
          className={`p-2 rounded-xl transition-all ${showSearch ? 'bg-primary text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
        >
          <Search className="w-4 h-4" />
        </button>
      </div>
      
      <div className="p-2 bg-slate-900 text-white rounded-xl shadow-sm">
        <LayoutGrid className="w-4 h-4" />
      </div>
    </div>
  );
}
