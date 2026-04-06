"use client";

import { useState, useEffect } from "react";
import { Loader2, FileText, LayoutList, ShieldCheck, Mail } from "lucide-react";
import { ClientOnly } from "@/components/ui/ClientOnly";
import { PremiumSpinner } from "@/components/ui/PremiumSpinner";
import InteractiveGantt from "@/components/timeline/InteractiveGantt";
import DonutChart from "@/components/charts/DonutChart";

export default function ClientPortalPage({ params }: { params: { token: string } }) {
  const [email, setEmail] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"list" | "gantt" | "summary">("list");
  const [branding, setBranding] = useState<{ appName: string; logoUrl: string }>({ appName: "CST OS", logoUrl: "" });
  const [projectName, setProjectName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/branding")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setBranding({ appName: d.appName || "CST OS", logoUrl: d.logoUrl || "" }); })
      .catch(() => {});
    // Peek: get project name for lock screen without email
    fetch(`/api/share/${params.token}?peek=true`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.name) setProjectName(d.name); })
      .catch(() => {});
  }, [params.token]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/share/${params.token}?email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (res.ok) {
        setProject(data);
        setIsUnlocked(true);
      } else {
        setError(data.error || "Access denied");
      }
    } catch {
      setError("Connection failure. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /* ── LOCK SCREEN ── */
  if (!isUnlocked) {
    return (
      <div className="min-h-screen bg-[#F7F7F5] flex flex-col items-center justify-center p-6 font-sans">

        {/* Logo */}
        <div className="mb-8 flex items-center gap-2">
          {branding.logoUrl ? (
            <img src={branding.logoUrl} alt={branding.appName} className="h-8 w-auto" />
          ) : (
            <span className="text-base font-black text-slate-800 tracking-tight">{branding.appName}</span>
          )}
        </div>

        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-slate-100">
          <div className="p-8 flex flex-col items-center">
            <div className="w-14 h-14 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center mb-5">
              <ShieldCheck className="w-7 h-7 text-indigo-600" />
            </div>
            {/* Project name or fallback */}
            <h1 className="text-xl font-black text-slate-900 tracking-tight mb-1 text-center">
              {projectName || "Project Roadmap"}
            </h1>
            <p className="text-sm text-slate-500 text-center mb-7 leading-relaxed">
              Enter your email address to access this project roadmap.
            </p>

            <form onSubmit={handleUnlock} className="w-full flex flex-col gap-3">
              <div className="relative group">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
                <input
                  type="email"
                  placeholder="client@company.com"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 rounded-xl text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all text-sm"
                />
              </div>
              <button
                disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-all shadow-md shadow-indigo-200 active:scale-[0.98] disabled:opacity-60 text-sm"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "View Roadmap →"}
              </button>
            </form>

            {error && (
              <div className="mt-4 w-full p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-medium text-center">
                {error}
              </div>
            )}
          </div>
        </div>

      </div>
    );
  }

  /* ── PORTAL ── */
  return (
    <div className="min-h-screen bg-[#F7F7F5] font-sans text-slate-900 pb-20">

      {/* Top nav */}
      <header className="sticky top-0 bg-white shadow-sm border-b border-slate-100 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.appName} className="h-7 w-auto" />
            ) : (
              <span className="text-sm font-black text-slate-800">{branding.appName}</span>
            )}
            <div className="h-5 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-black text-indigo-600 uppercase tracking-widest leading-tight">
                {project?.companyName || "Client Portal"}
              </p>
              <p className="text-sm font-black text-slate-800 leading-tight truncate max-w-[220px] md:max-w-sm">
                {project?.name}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
            {(["list", "gantt", "summary"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                  activeTab === t ? "bg-white shadow text-indigo-600" : "text-slate-400 hover:text-slate-600"
                }`}
              >
                {t === "list" ? "Action Items" : t === "gantt" ? "Timeline" : "Overview"}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">

        {/* ACTION ITEMS */}
        {activeTab === "list" && (
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex items-center gap-2 mb-5">
              <LayoutList className="w-4 h-4 text-indigo-600" />
              <h3 className="text-xs font-black text-slate-800 uppercase tracking-widest">Action Items</h3>
              <span className="ml-auto text-[10px] font-black text-slate-400 uppercase tracking-widest">{project?.tasks?.length || 0} tasks</span>
            </div>
            {project?.tasks?.map((task: any) => (
              <div key={task.id} className="flex flex-col md:flex-row md:items-center justify-between p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all group">
                <div className="flex flex-col mb-3 md:mb-0">
                  <span className="text-[9px] font-black text-indigo-600/50 group-hover:text-indigo-600 transition-colors uppercase tracking-widest mb-0.5">{task.taskCode}</span>
                  <span className="font-black text-slate-800 text-base leading-snug">{task.subject}</span>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[9px] font-black uppercase rounded-full border border-slate-200">
                      {task.owner}
                    </span>
                    <span className={`px-2 py-0.5 text-[9px] font-black uppercase rounded-full border ${
                      task.status === "completed"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : task.status === "in-progress"
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-slate-50 text-slate-500 border-slate-200"
                    }`}>
                      {task.status || "Pending"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-6 border-t md:border-t-0 pt-3 md:pt-0 border-slate-100 shrink-0">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Start</span>
                    <span className="text-xs font-bold text-slate-600">
                      {new Date(task.startDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                  <div className="flex flex-col bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 min-w-[130px]">
                    <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-0.5">Target Date</span>
                    <span className="text-sm font-black text-indigo-700">
                      {new Date(task.plannedEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIMELINE GANTT */}
        {activeTab === "gantt" && (
          <div className="h-[calc(100vh-180px)] animate-in fade-in duration-300">
            <ClientOnly>
              <InteractiveGantt
                events={project.tasks.map((t: any) => ({
                  ...t,
                  endDate: (t.plannedEnd || t.externalPlannedEnd || "").split("T")[0],
                  startDate: (t.startDate || "").split("T")[0],
                  paddingDays: t.paddingDays || 0,
                }))}
                onUpdateEvents={() => {}}
                scale="day"
              />
            </ClientOnly>
          </div>
        )}

        {/* OVERVIEW */}
        {activeTab === "summary" && (
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600 border border-indigo-100">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 uppercase tracking-widest">Project Overview</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Quick reference for project health</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col gap-5">
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Global Status</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      <span className="text-sm font-black text-slate-800 uppercase">{project?.status || "Active"}</span>
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Official Kickoff</span>
                    <p className="text-sm font-black text-slate-800 mt-1">
                      {project?.startDate
                        ? new Date(project.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                        : "TBD"}
                    </p>
                  </div>
                  <div className="pt-4 border-t border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Deliverables</span>
                    <p className="text-2xl font-black text-slate-800 mt-1">{project?.tasks?.length || 0}</p>
                  </div>
                </div>
                <div className="flex items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-100">
                  <DonutChart
                    completed={project?.tasks?.filter((t: any) => t.status === "completed").length || 0}
                    inProgress={project?.tasks?.filter((t: any) => t.status === "in-progress").length || 0}
                    pending={project?.tasks?.filter((t: any) => !t.status || t.status === "pending").length || 0}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
