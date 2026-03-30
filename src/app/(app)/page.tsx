"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, Trash2, FileText, Clock, GitBranch, Workflow, ClipboardList, Zap, Lock, ArrowRight } from "lucide-react";

interface SavedWork {
  id: string;
  appType: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

const APP_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  architect: { icon: <GitBranch className="h-5 w-5" />, color: "bg-primary/10 text-primary" },
  brd: { icon: <FileText className="h-5 w-5" />, color: "bg-primary/10 text-primary" },
  timeline: { icon: <Clock className="h-5 w-5" />, color: "bg-primary/10 text-primary" },
};

const APPS = [
  {
    title: "BRD Maker",
    description: "Generate comprehensive PRD / BRD documents from meeting transcripts via AI.",
    icon: <ClipboardList className="h-6 w-6 text-emerald-600" />,
    href: "/brd",
    colorClass: "bg-emerald-50",
    borderColor: "border-emerald-100",
    tag: "Document Gen",
  },
  {
    title: "Roadmap",
    description: "Intelligent project scheduling and interactive Gantt visualization.",
    icon: <Clock className="h-6 w-6 text-violet-600" />,
    href: "/timeline",
    colorClass: "bg-violet-50",
    borderColor: "border-violet-100",
    tag: "Planning",
  },
  {
    title: "Architect",
    description: "Map and automate complex client operational flows with AI diagrams.",
    icon: <Workflow className="h-6 w-6 text-blue-600" />,
    href: "/architect",
    colorClass: "bg-blue-50",
    borderColor: "border-blue-100",
    tag: "Analysis",
  },
  {
    title: "Task Control",
    description: "Daily task tracking, SOD/EOD reporting and DAR performance.",
    icon: <Zap className="h-6 w-6 text-amber-600" />,
    href: "/tasks",
    colorClass: "bg-amber-50",
    borderColor: "border-amber-100",
    tag: "Implementation",
  },
];

export default function Home() {
  const { data: session } = useSession();
  const [works, setWorks] = useState<SavedWork[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("All");

  useEffect(() => {
    if (session?.user) loadWorks();
  }, [session]);

  const loadWorks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/works");
      if (res.ok) setWorks(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const deleteWork = async (id: string) => {
    if (!confirm("Delete this saved work?")) return;
    await fetch("/api/works/" + id, { method: "DELETE" });
    setWorks(works.filter(w => w.id !== id));
  };

  const filteredWorks = filter === "All" ? works : works.filter(w => w.appType === filter.toLowerCase());

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Hero */}
      <div className="px-8 pt-16 pb-12 max-w-5xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 bg-primary/8 border border-primary/15 rounded-full px-4 py-1.5 mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-black uppercase tracking-widest text-primary">CST FlowDesk</span>
        </div>

        <h1 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-900 leading-[1.05] mb-4">
          Your Client Success<br />
          <span className="text-primary">Operating System</span>
        </h1>
        <p className="text-base text-slate-500 font-medium max-w-xl mx-auto leading-relaxed mb-8">
          AI-powered tools for every step of the journey — from signed contract to go-live.
        </p>

        {!session && (
          <Link href="/auth/signin">
            <button className="inline-flex items-center gap-2 bg-primary text-white px-7 py-3.5 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5">
              Sign In to Get Started
              <ArrowRight className="w-4 h-4" />
            </button>
          </Link>
        )}
      </div>

      {/* App Grid */}
      <div className="px-8 pb-16 max-w-5xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {APPS.map((app) => (
            <AppCard key={app.href} {...app} isAuthenticated={!!session} />
          ))}
        </div>

        {/* Unauthenticated CTA */}
        {!session && (
          <div className="mt-10 flex flex-col items-center gap-3 py-10 px-6 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-primary" />
            </div>
            <p className="text-sm font-bold text-slate-700">Sign in to access all tools</p>
            <p className="text-xs text-slate-400 max-w-xs">
              Access is restricted to <strong>@mobileoptima.com</strong>, <strong>@tarkie.com</strong>, and <strong>@olern.ph</strong> accounts.
            </p>
            <Link href="/auth/signin">
              <button className="mt-2 bg-primary text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-primary/90 transition-all">
                Sign In
              </button>
            </Link>
          </div>
        )}

        {/* Saved Works — authenticated only */}
        {session?.user && (
          <div className="mt-14">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">Recent Work</h2>
              <div className="flex gap-2">
                {["All", "Architect", "BRD", "Timeline"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${
                      filter === f
                        ? "bg-primary text-white"
                        : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : filteredWorks.length === 0 ? (
              <div className="bg-white border border-slate-100 rounded-2xl p-10 text-center">
                <p className="text-sm text-slate-400">No saved work yet. Use any app above and save your output to see it here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWorks.map((work) => {
                  const appMeta = APP_ICONS[work.appType] || APP_ICONS.architect;
                  return (
                    <div key={work.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group">
                      <div className="flex items-start justify-between mb-3">
                        <div className={"flex items-center justify-center w-9 h-9 rounded-xl " + appMeta.color}>
                          {appMeta.icon}
                        </div>
                        <button onClick={() => deleteWork(work.id)} className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 transition-all p-1">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <h3 className="font-bold text-sm mb-1 truncate text-slate-800">{work.title}</h3>
                      <p className="text-[11px] text-slate-400 mb-4">
                        {work.appType.charAt(0).toUpperCase() + work.appType.slice(1)} · {new Date(work.updatedAt).toLocaleDateString()}
                      </p>
                      <Link href={"/" + work.appType + "?loadId=" + work.id}>
                        <button className="w-full text-[11px] font-black uppercase tracking-widest py-2 rounded-xl bg-primary/8 text-primary hover:bg-primary/15 transition-colors">
                          Open
                        </button>
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AppCard({
  title,
  description,
  icon,
  href,
  colorClass,
  borderColor,
  tag,
  isAuthenticated,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  colorClass: string;
  borderColor: string;
  tag: string;
  isAuthenticated: boolean;
}) {
  const router = useRouter();

  const handleClick = () => {
    if (!isAuthenticated) {
      router.push("/auth/signin?callbackUrl=" + encodeURIComponent(href));
    } else {
      router.push(href);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`group relative flex flex-col bg-white rounded-2xl p-5 border shadow-sm cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 ${borderColor}`}
    >
      {!isAuthenticated && (
        <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
          <Lock className="w-3 h-3 text-slate-400" />
        </div>
      )}
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${colorClass} group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{tag}</span>
      <h3 className="text-base font-black text-slate-800 mb-1">{title}</h3>
      <p className="text-[12px] text-slate-500 leading-relaxed flex-1">{description}</p>
      <div className={`mt-4 flex items-center gap-1 text-[11px] font-black uppercase tracking-widest transition-colors ${isAuthenticated ? "text-primary" : "text-slate-400"}`}>
        {isAuthenticated ? "Launch App" : "Sign in to access"}
        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </div>
  );
}
