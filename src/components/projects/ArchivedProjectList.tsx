"use client";

import React, { useState, useEffect } from "react";
import { Archive, RotateCcw, Building2, Calendar, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface Project {
  id: string;
  name: string;
  companyName: string;
  startDate: string;
  archived: boolean;
}

export default function ArchivedProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { showToast } = useToast();

  const fetchArchived = async () => {
    try {
      const res = await fetch("/api/projects?showArchived=true");
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.projects || []);
        setProjects(list.filter((p: Project) => p.archived));
      }
    } catch (err) {
      showToast("Failed to load archive", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArchived();
  }, []);

  const restoreProject = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false })
      });
      if (res.ok) {
        showToast("Project restored to active roadmaps", "success");
        setProjects(prev => prev.filter(p => p.id !== id));
        // Force a page reload or sidebar refresh if necessary, 
        // but for now, just updating the local list is enough.
        window.location.reload(); 
      }
    } catch (err) {
      showToast("Restore failed", "error");
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-[11px] font-black uppercase text-slate-400 tracking-widest">Loading Library…</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center gap-4 mb-12">
        <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
          <Archive size={28} />
        </div>
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight">Archived Roadmaps</h1>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">Historic project data and templates</p>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-dashed border-slate-200 p-20 flex flex-col items-center text-center">
          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center text-slate-200 mb-6">
            <Archive size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-400 uppercase tracking-widest">Archive is empty</h3>
          <p className="text-sm text-slate-300 mt-2">Projects you archive will appear here for restoration if needed.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {projects.map(project => (
            <div key={project.id} className="group bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-500 relative overflow-hidden">
              <div className="flex flex-col h-full relative z-10">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:text-primary transition-colors">
                      <Building2 size={20} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-800 tracking-tight leading-tight">{project.name}</h3>
                      <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{project.companyName}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 mt-auto pt-6 border-t border-slate-50">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Started</span>
                    <div className="flex items-center gap-2 text-slate-600 font-bold text-xs uppercase">
                      <Calendar size={12} className="opacity-40" />
                      {new Date(project.startDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                    </div>
                  </div>

                  <button 
                    onClick={() => restoreProject(project.id)}
                    disabled={actionLoading === project.id}
                    className="ml-auto px-6 py-3 bg-slate-50 hover:bg-primary hover:text-white rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-400 transition-all flex items-center gap-2"
                  >
                    {actionLoading === project.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    Restore
                  </button>
                </div>
              </div>

              {/* Abstract subtle decoration */}
              <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
