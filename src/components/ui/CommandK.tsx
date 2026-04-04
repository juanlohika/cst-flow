"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, Sparkles, FolderOpen, X, Command, ChevronRight, Zap, Building2, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

export default function CommandK() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; type: 'app' | 'project'; href: string }[]>([]);
  const [aiApps, setAiApps] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  // Load data once
  useEffect(() => {
    Promise.all([
      fetch("/api/apps").then(r => r.ok ? r.json() : []),
      fetch("/api/projects").then(r => r.ok ? r.json() : [])
    ]).then(([appsData, projectsData]) => {
      if (Array.isArray(appsData)) setAiApps(appsData.filter((a: any) => a.isActive));
      if (Array.isArray(projectsData)) setProjects(projectsData);
    }).catch(() => {});
  }, []);

  // Keyboard shortcut: CMD+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setQuery("");
    }
  }, [isOpen]);

  // Search logic
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const q = query.toLowerCase();
    const appMatches = aiApps.filter(a => a.name.toLowerCase().includes(q)).map(a => ({
      id: a.id, name: a.name, type: 'app' as const, href: a.href
    }));
    const projectMatches = projects.filter(p => p.name.toLowerCase().includes(q)).map(p => ({
      id: p.id, name: p.name, type: 'project' as const, href: `/tasks?project=${p.id}`
    }));

    setResults([...appMatches, ...projectMatches].slice(0, 8));
  }, [query, aiApps, projects]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] px-4">
      {/* Search Backdrop (Deep Focus Blur) */}
      <div 
        className="absolute inset-0 bg-white/40 backdrop-blur-md animate-in fade-in duration-300" 
        onClick={() => setIsOpen(false)}
      />

      {/* Search Modal (Glassmorphism White) */}
      <div className="relative w-full max-w-xl bg-white/90 backdrop-blur-xl rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-white/50 overflow-hidden animate-in zoom-in-95 slide-in-from-top-4 duration-300">
        
        {/* Input Area */}
        <div className="flex items-center px-4 h-14 border-b border-slate-100/50">
          <Search className="w-5 h-5 text-primary mr-3 opacity-60" />
          <input 
            ref={inputRef}
            type="text" 
            placeholder="Search Projects, AI Apps, or Hubs..." 
            className="flex-1 bg-transparent border-none outline-none text-slate-800 font-medium placeholder:text-slate-400 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-50 rounded border border-slate-100 text-[10px] font-black text-slate-400">
             <Command size={10}/> K
          </div>
          <button onClick={() => setIsOpen(false)} className="ml-3 p-1 hover:bg-slate-50 rounded-lg text-slate-300 transition-colors">
            <X size={16}/>
          </button>
        </div>

        {/* Results Area */}
        <div className="max-h-[50vh] overflow-y-auto p-2 styled-scroll">
          {results.length > 0 ? (
            <div className="space-y-1">
               <div className="px-3 pb-1 text-[10px] font-black uppercase text-slate-300 tracking-widest">Search Results</div>
               {results.map((res) => (
                <button
                  key={`${res.type}-${res.id}`}
                  onClick={() => {
                    router.push(res.href);
                    setIsOpen(false);
                  }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-primary/5 text-left group transition-all"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shadow-sm transition-transform group-hover:scale-105 ${
                    res.type === 'app' ? 'bg-amber-50 border-amber-100 text-amber-600' : 'bg-blue-50 border-blue-100 text-blue-600'
                  }`}>
                    {res.type === 'app' ? <Sparkles size={16}/> : <FolderOpen size={16}/>}
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-bold text-slate-700 group-hover:text-primary transition-colors">{res.name}</div>
                    <div className="text-[10px] font-black uppercase tracking-tighter text-slate-300 opacity-80">
                      {res.type === 'app' ? 'AI Intelligence' : 'Contextual Project'}
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-slate-200 group-hover:translate-x-0.5 transition-all" />
                </button>
              ))}
            </div>
          ) : query ? (
            <div className="py-12 flex flex-col items-center justify-center text-slate-300">
               <Search size={32} className="opacity-10 mb-2"/>
               <p className="text-sm font-medium italic opacity-60 text-slate-400">No results found for "{query}"</p>
            </div>
          ) : (
            <div className="py-2">
               <div className="px-3 pb-2 text-[10px] font-black uppercase text-slate-300 tracking-widest">Quick Actions</div>
               <div className="grid grid-cols-2 gap-2 px-1">
                  <button onClick={() => {router.push('/tasks'); setIsOpen(false);}} className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50/50 hover:bg-primary/5 border border-slate-100/50 text-left transition-all">
                    <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm text-primary"><Zap size={14}/></div>
                    <span className="text-[12px] font-bold text-slate-600">Tasks Hub</span>
                  </button>
                  <button onClick={() => {router.push('/accounts'); setIsOpen(false);}} className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50/50 hover:bg-primary/5 border border-slate-100/50 text-left transition-all">
                    <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shadow-sm text-primary"><Building2 size={14}/></div>
                    <span className="text-[12px] font-bold text-slate-600">Accounts Hub</span>
                  </button>
               </div>
            </div>
          )}
        </div>
        
        {/* Legend */}
        <div className="px-4 py-2 bg-slate-50/80 border-t border-slate-100/50 flex items-center justify-between">
           <div className="flex items-center gap-3">
             <span className="flex items-center gap-1 text-[9px] font-bold text-slate-300"><ChevronRight size={10}/> To Select</span>
             <span className="flex items-center gap-1 text-[9px] font-bold text-slate-300"><ChevronDown size={10}/> To Navigate</span>
           </div>
           <div className="text-[9px] font-black text-primary/30 uppercase tracking-tighter">CST OS WORKSPACE</div>
        </div>
      </div>
    </div>
  );
}
