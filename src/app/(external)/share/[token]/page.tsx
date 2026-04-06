"use client";

import { useState, useEffect } from "react";
import { Loader2, Calendar, FileText, CheckCircle2, LayoutList, Users, ShieldCheck, Mail } from "lucide-react";
import { ClientOnly } from "@/components/ui/ClientOnly";
import { PremiumSpinner } from "@/components/ui/PremiumSpinner";
import InteractiveGantt from "@/components/timeline/InteractiveGantt";

/**
 * Client Portal Page: Indestructible Share Link.
 * 
 * Provides a read-only, padded view of the project roadmap.
 * Clients enter their email to unlock the view.
 */
export default function ClientPortalPage({ params }: { params: { token: string } }) {
  const [email, setEmail] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"list" | "gantt" | "summary">("list");

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${params.token}`);
      const data = await res.json();
      if (res.ok) {
        setProject(data);
        setIsUnlocked(true);
      } else {
        setError(data.error || "Access denied");
      }
    } catch (err) {
      setError("Connection failure");
    } finally {
      setLoading(false);
    }
  };

  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 p-8 flex flex-col items-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                <ShieldCheck className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">Project Roadmap Access</h1>
            <p className="text-slate-500 text-sm text-center mb-8">Enter your registered email address to view the latest project progress and timeline.</p>
            
            <form onSubmit={handleUnlock} className="w-full flex flex-col gap-4">
                <div className="relative group">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <input 
                      type="email" 
                      placeholder="client@company.com" 
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 py-3.5 pl-12 pr-4 rounded-xl text-slate-700 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" 
                    />
                </div>
                <button 
                  disabled={loading}
                  className="w-full bg-primary hover:bg-primary-hover text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg active:scale-[0.98]"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unlock Roadmap"}
                </button>
            </form>
            
            {error && <p className="mt-4 text-rose-500 text-xs font-medium animate-pulse">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 border-t-4 border-primary pb-20">
      <header className="sticky top-0 bg-white shadow-sm border-b z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-sm font-bold text-primary uppercase tracking-widest">{project?.companyName || "Project Roadmap"}</h2>
            <h1 className="text-xl font-bold text-slate-800 truncate max-w-[320px] md:max-w-md">{project?.name}</h1>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
             {(["list", "gantt", "summary"] as const).map((t) => (
               <button
                 key={t}
                 onClick={() => setActiveTab(t)}
                 className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === t ? "bg-white shadow-md text-primary" : "text-slate-400 hover:text-slate-600"}`}
               >
                 {t === 'list' ? 'Action Items' : t === 'gantt' ? 'Visual Roadmap' : 'Project Info'}
               </button>
             ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">
        {activeTab === "summary" && (
           <div className="max-w-3xl mx-auto bg-white rounded-[2.5rem] p-12 border border-slate-100 shadow-xl">
              <div className="flex items-center gap-4 mb-10">
                 <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                    <FileText className="w-6 h-6" />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Project Overview</h3>
                    <p className="text-slate-400 text-sm font-medium">Quick reference for project metadata and health status.</p>
                 </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                 <div className="flex flex-col gap-6">
                    <div className="space-y-1">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Status</span>
                       <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse" />
                          <span className="font-bold text-slate-700">{project?.status || "Active"}</span>
                       </div>
                    </div>
                    <div className="space-y-1">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Official Kickoff</span>
                       <span className="block font-bold text-slate-700">{new Date(project?.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
                    </div>
                 </div>
                 <div className="flex flex-col gap-6">
                    <div className="space-y-1">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deliverables</span>
                       <span className="block font-bold text-slate-700">{project?.tasks?.length || 0} Task Items</span>
                    </div>
                    <div className="space-y-1">
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Sync</span>
                       <span className="block font-bold text-slate-700">{new Date().toLocaleTimeString()}</span>
                    </div>
                 </div>
              </div>
           </div>
        )}

        {activeTab === "list" && (
            <div className="max-w-5xl mx-auto space-y-6">
                <div className="flex items-center justify-between mb-2">
                   <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                      <LayoutList className="w-4 h-4 text-primary" /> Action Item List
                   </h3>
                </div>
                <div className="flex flex-col gap-4">
                    {project?.tasks?.map((task: any) => (
                        <div key={task.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all duration-300 group">
                            <div className="flex flex-col mb-4 md:mb-0">
                                <span className="text-[9px] font-black text-primary opacity-40 group-hover:opacity-100 transition-opacity uppercase tracking-widest">{task.taskCode}</span>
                                <span className="font-black text-slate-800 text-lg tracking-tight">{task.subject}</span>
                                <div className="flex items-center gap-2 mt-2">
                                   <span className="px-2 py-0.5 bg-slate-50 text-slate-400 text-[8px] font-black uppercase rounded border border-slate-200">Owner: {task.owner}</span>
                                   <span className={`px-2 py-0.5 text-[8px] font-black uppercase rounded ${task.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                                      {task.status || "Pending"}
                                   </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-10 border-t md:border-t-0 pt-4 md:pt-0 border-slate-50">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Start Date</span>
                                    <span className="text-xs font-bold text-slate-600">{new Date(task.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                                </div>
                                <div className="flex flex-col bg-primary/5 p-3 rounded-2xl border border-primary/5 min-w-[140px]">
                                    <span className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">Target Completion</span>
                                    <span className="text-sm font-black text-primary italic">
                                        {new Date(task.externalPlannedEnd || task.plannedEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {activeTab === "gantt" && (
          <div className="h-[calc(100vh-200px)] animate-in fade-in duration-500 delay-150">
             <InteractiveGantt 
               events={project.tasks.map((t: any) => ({ 
                 ...t, 
                 endDate: (t.externalPlannedEnd || t.plannedEnd).split('T')[0],
                 startDate: t.startDate.split('T')[0],
                 paddingDays: t.paddingDays || 0
               }))} 
               onUpdateEvents={() => {}} // Read-only for Client
               scale="day"
             />
          </div>
        )}
      </main>
    </div>
  );
}
