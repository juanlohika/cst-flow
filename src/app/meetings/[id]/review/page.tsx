"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Users,
  Calendar,
  ExternalLink,
  RefreshCw,
  Plus,
  Save,
  CheckCircle2,
  Paperclip,
  FileText,
  X
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import GlobalBar from "@/components/layout/GlobalBar";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  title: string;
  owner?: string;
  due?: string;
  priority?: "high" | "medium" | "low";
}

interface MeetingTranscript {
  minutesOfMeeting: string;
  generatedBRD: string;
  generatedTasks: string;
}

interface Meeting {
  id: string;
  title: string;
  companyName?: string;
  meetingType: string;
  scheduledAt: string;
  status: string;
  projectId?: string;
  architectFlowEnabled: boolean;
  brdMakerEnabled: boolean;
  taskManagerEnabled: boolean;
  timelineMakerEnabled: boolean;
  attendees: any[];
  transcript: MeetingTranscript | null;
  meetingPrepSession?: any;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const [inTable, setInTable] = useState(false);
  const [tableRows, setTableRows] = useState<string[][]>([]);

  // Simple rendering for high-fidelity feel
  return (
    <div className="space-y-1.5 brd-markdown-view">
      {lines.map((line, idx) => {
        // Table Detection (Basic)
        if (line.includes("|") && line.trim().startsWith("|")) {
          const cells = line.split("|").map(c => c.trim()).filter(c => c !== "");
          if (line.includes("---")) return null; // skip separators
          return (
            <div key={idx} className="flex border-b border-slate-100 last:border-0 bg-white/50">
              {cells.map((cell, ci) => (
                <div key={ci} className={`px-3 py-2 text-[10px] ${idx === 0 ? "font-bold text-slate-800" : "text-slate-600"} border-r border-slate-100 last:border-0 flex-1`}>
                  {cell}
                </div>
              ))}
            </div>
          );
        }

        if (line.startsWith("# ")) {
          return (
            <h1 key={idx} className="text-sm font-black text-slate-900 mt-6 mb-2 uppercase tracking-tight border-b-2 border-primary/20 pb-1">
              {line.slice(2)}
            </h1>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h2 key={idx} className="text-xs font-bold text-slate-800 mt-4 mb-2">
              {line.slice(3)}
            </h2>
          );
        }
        if (line.startsWith("### ")) {
          return (
            <h3 key={idx} className="text-[11px] font-bold text-slate-700 mt-3 mb-1">
              {line.slice(4)}
            </h3>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={idx} className="flex gap-2 pl-2">
              <span className="text-primary font-bold">•</span>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {line.slice(2)}
              </p>
            </div>
          );
        }
        if (line.trim() === "") return <div key={idx} className="h-1" />;
        
        return (
          <p key={idx} className="text-[11px] text-slate-600 leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-50 text-red-600 border-red-200",
  medium: "bg-amber-50 text-amber-600 border-amber-200",
  low: "bg-surface-muted text-text-secondary border-border-default",
};

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  "in-progress": "bg-green-50 text-green-700 border-green-200",
  completed: "bg-surface-muted text-text-secondary border-border-default",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

// ─── Page export ──────────────────────────────────────────────────────────────

export default function MeetingReviewPage() {
  return (
    <AuthGuard>
      <MeetingReview />
    </AuthGuard>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

type Tab = "minutes" | "brd" | "action-items";

function MeetingReview() {
  const params = useParams();
  const router = useRouter();
  const meetingId = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("minutes");

  const loadMeeting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [meetingId]);

  useEffect(() => {
    loadMeeting();
  }, [loadMeeting]);

  const handleProcess = async () => {
    setProcessing(true);
    try {
      await fetch(`/api/meetings/${meetingId}/process`, { method: "POST" });
      await loadMeeting();
    } catch (err) {
      console.error(err);
    } finally {
      setProcessing(false);
    }
  };

  const scheduledDate = meeting ? new Date(meeting.scheduledAt) : null;

  const tasks: Task[] = (() => {
    if (!meeting?.transcript?.generatedTasks) return [];
    try {
      return JSON.parse(meeting.transcript.generatedTasks) as Task[];
    } catch {
      return [];
    }
  })();

  // ─── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <>
        <GlobalBar breadcrumbs={[{ label: "Meetings", href: "/meetings" }, { label: "Review" }]} />
        <div className="main-content flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      </>
    );
  }

  if (!meeting) {
    return (
      <>
        <GlobalBar breadcrumbs={[{ label: "Meetings", href: "/meetings" }, { label: "Review" }]} />
        <div className="main-content flex items-center justify-center">
          <p className="text-[11px] text-text-secondary">Meeting not found.</p>
        </div>
      </>
    );
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <GlobalBar
        breadcrumbs={[
          { label: "Meetings", href: "/meetings" },
          { label: meeting.title },
          { label: "Review" },
        ]}
      />

      <div className="main-content overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-4">

          {/* Header */}
          <div className="space-y-3">
            <button
              onClick={() => router.push("/meetings")}
              className="flex items-center gap-1.5 text-[11px] text-text-secondary hover:text-text-primary transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Meetings
            </button>

            <div className="flex flex-col gap-1.5">
              <h1 className="text-lg font-semibold text-text-primary">{meeting.title}</h1>

              <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                {meeting.companyName && (
                  <span className="font-medium text-text-primary">{meeting.companyName}</span>
                )}
                {scheduledDate && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {scheduledDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {" "}
                    {scheduledDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  {meeting.attendees?.length ?? 0} attendee{(meeting.attendees?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_STYLES[meeting.status] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                  {meeting.status}
                </span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-surface-muted text-text-secondary border-border-default capitalize">
                  {meeting.meetingType?.replace(/-/g, " ") || "meeting"}
                </span>
              </div>
            </div>
          </div>

          {/* No transcript state */}
          {!meeting.transcript ? (
            <div className="border border-dashed border-border-default rounded-md p-10 text-center space-y-3">
              <p className="text-[11px] text-text-secondary">No outputs generated yet.</p>
              <button
                onClick={handleProcess}
                disabled={processing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-md text-[11px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                {processing ? "Processing…" : "Process Meeting"}
              </button>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="border-b border-border-default">
                <div className="flex items-center gap-0">
                  {(["minutes", "brd", "action-items"] as Tab[]).map(tab => {
                    const labels: Record<Tab, string> = {
                      minutes: "Minutes",
                      brd: "BRD",
                      "action-items": "Action Items",
                    };
                    const isActive = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-4 h-9 text-[11px] font-medium border-b-2 transition-colors ${
                          isActive
                            ? "border-primary text-primary"
                            : "border-transparent text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {labels[tab]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tab content */}
              <div className="min-h-[300px]">
                {activeTab === "minutes" && (
                  <div className="bg-surface-subtle rounded-md p-4">
                    {meeting.transcript.minutesOfMeeting ? (
                      <MarkdownContent content={meeting.transcript.minutesOfMeeting} />
                    ) : (
                      <p className="text-[11px] text-text-secondary">No minutes available.</p>
                    )}
                  </div>
                )}

                {activeTab === "brd" && (
                  <div className="bg-surface-subtle rounded-md p-4">
                    {meeting.transcript.generatedBRD ? (
                      <MarkdownContent content={meeting.transcript.generatedBRD} />
                    ) : (
                      <p className="text-[11px] text-text-secondary">No BRD generated.</p>
                    )}
                  </div>
                )}

                {activeTab === "action-items" && (
                  <TaskStagingTable initialTasks={tasks} meetingId={meetingId} projectId={meeting?.projectId} onTasksCommitted={loadMeeting} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Task Staging Component ───────────────────────────────────────────────────

function TaskStagingTable({ initialTasks, meetingId, projectId, onTasksCommitted }: { initialTasks: any[]; meetingId: string; projectId?: string; onTasksCommitted: () => void }) {
  const [tasks, setTasks] = useState(initialTasks.map((t: any, i: number) => ({ 
    id: t.id || i, 
    ...t, 
    selected: true,
    start: new Date().toISOString().split('T')[0],
    due: t.due || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    startTime: "09:00",
    endTime: "10:00",
    assignedIds: t.assignedTo ? [t.assignedTo] : []
  })));
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [committedCodes, setCommittedCodes] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/users/members')
      .then(r => r.json())
      .then(data => {
        if (data && typeof data === 'object' && (data.users || data.roles)) {
          const flat = [
            ...(data.roles || []).map((r: any) => ({ ...r, type: 'role' })),
            ...(data.users || []).map((u: any) => ({ ...u, type: 'user' }))
          ];
          setMembers(flat);
        } else if (Array.isArray(data)) {
          setMembers(data); // compatibility if it was already flattened
        }
      })
      .catch((err) => console.error("Failed to load members:", err));
  }, []);

  const commitTasks = async () => {
    setLoading(true);
    const toCommit = tasks.filter(t => t.selected).map(t => ({
      ...t,
      // Combine date + time
      plannedStart: `${t.start}T${t.startTime}:00Z`,
      plannedEnd: `${t.due}T${t.endTime}:00Z`,
      assignedIds: t.assignedIds
    }));

    if (toCommit.length === 0) {
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/meetings/${meetingId}/tasks/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: toCommit, projectId })
      });
      const data = await res.json();
      if (res.ok) {
        setCommittedCodes(data.codes || []);
        setShowSuccessModal(true);
        onTasksCommitted();
        setTasks(tasks.filter(t => !t.selected)); // remove committed
      } else {
        alert("Failed to commit tasks: " + (data.error || "Unknown server error"));
      }
    } catch (err: any) {
      alert("Network Error: " + err.message);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <div className="border border-border-default rounded-md overflow-hidden bg-white">
        <table className="w-full text-[11px]">
          <thead className="bg-surface-subtle border-b border-border-default">
            <tr>
              <th className="px-3 py-2 text-left w-8">
                <input type="checkbox" className="rounded border-border-default focus:ring-primary" checked={tasks.length > 0 && tasks.every(t => t.selected)} onChange={e => setTasks(tasks.map(t => ({...t, selected: e.target.checked})))} />
              </th>
              <th className="px-3 py-2 text-left font-medium text-text-secondary">Task Subject</th>
              <th className="px-3 py-2 text-left font-medium text-text-secondary w-40">Assign To</th>
              <th className="px-3 py-2 text-left font-medium text-text-secondary w-28">Start Date</th>
              <th className="px-3 py-2 text-left font-medium text-text-secondary w-28">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 ? (
              <tr><td colSpan={4} className="px-3 py-4 text-center text-text-secondary text-[11px]">No tasks to stage.</td></tr>
            ) : tasks.map((task) => {
              const assignedVal = task.assignedTo ? `user:${task.assignedTo}` : task.owner || "";
              return (
              <tr key={task.id} className="border-b border-border-default last:border-0 h-10 group">
                <td className="px-3 py-2">
                  <input type="checkbox" className="rounded border-border-default focus:ring-primary" checked={task.selected} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, selected: e.target.checked} : t))} />
                </td>
                <td className="px-3 py-2 text-text-primary">
                  <input className="w-full bg-transparent border border-transparent hover:border-border-default focus:border-primary text-text-primary px-1 py-0.5 rounded transition-colors" value={task.title} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, title: e.target.value} : t))} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {task.assignedIds.map((id: string) => {
                      const m = members.find(m => m.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 bg-blue-50 text-[#2162F9] px-1.5 py-0.5 rounded text-[10px] font-bold border border-blue-100">
                          {m?.name || "User"}
                          <button onClick={() => setTasks(tasks.map(t => t.id === task.id ? {...t, assignedIds: t.assignedIds.filter((aid: string) => aid !== id)} : t))}>
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      );
                    })}
                    <select 
                      className="bg-transparent text-text-secondary border border-dashed border-border-default hover:border-primary rounded px-1 py-0.5 transition-colors cursor-pointer"
                      value=""
                      onChange={e => {
                        const val = e.target.value;
                        if (!val || task.assignedIds.includes(val)) return;
                        setTasks(tasks.map(t => t.id === task.id ? {...t, assignedIds: [...t.assignedIds, val]} : t));
                      }}
                    >
                      <option value="">+ Add</option>
                      {Array.isArray(members) && members.filter(m => m.type === 'user').map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <input type="date" className="w-full bg-transparent border border-transparent text-text-secondary hover:border-border-default focus:border-primary rounded px-1 py-0.5 transition-colors" value={task.start || ""} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, start: e.target.value} : t))} />
                    <input type="time" className="w-full bg-transparent border border-transparent text-text-secondary hover:border-border-default focus:border-primary rounded px-1 py-0.5 transition-colors scale-90 origin-left" value={task.startTime || "09:00"} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, startTime: e.target.value} : t))} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="space-y-1">
                    <input type="date" className="w-full bg-transparent border border-transparent text-text-secondary hover:border-border-default focus:border-primary rounded px-1 py-0.5 transition-colors" value={task.due || ""} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, due: e.target.value} : t))} />
                    <input type="time" className="w-full bg-transparent border border-transparent text-text-secondary hover:border-border-default focus:border-primary rounded px-1 py-0.5 transition-colors scale-90 origin-left" value={task.endTime || "10:00"} onChange={e => setTasks(tasks.map(t => t.id === task.id ? {...t, endTime: e.target.value} : t))} />
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      
      <div className="flex items-center justify-between">
        <button onClick={() => setTasks([...tasks, { id: Date.now().toString(), title: "New Task", selected: true }])} className="px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-surface-subtle border border-transparent hover:border-border-default transition-all rounded flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" /> Add Task
        </button>

        <div className="flex items-center gap-3">
          {!projectId && <span className="text-[11px] text-red-500">Meeting must be linked to a project to commit tasks.</span>}
          <button onClick={commitTasks} disabled={loading || !projectId || !tasks.some(t => t.selected)} className="px-3 py-1.5 text-[11px] font-medium bg-primary hover:bg-primary-hover text-white rounded shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition-colors">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Commit {tasks.filter(t => t.selected).length} Selected Tasks
          </button>
        </div>
      </div>

      {/* Success Modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-blue-50 text-[#2162F9] rounded-full flex items-center justify-center mx-auto mb-6 scale-110">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">Tasks Committed!</h2>
              <p className="text-sm text-slate-500 mb-6">
                {committedCodes.length} action items have been registered to the system under the following references:
              </p>
              
              <div className="bg-slate-50 rounded-xl p-4 mb-8 max-h-32 overflow-y-auto thin-scrollbar space-y-2 border border-slate-100">
                {committedCodes.map(code => (
                  <div key={code} className="text-[11px] font-mono font-bold text-[#2162F9] bg-white border border-blue-100 rounded-md py-1.5 px-3 shadow-sm">
                    {code}
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                <Link 
                  href="/tasks" 
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#2162F9] text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-200 hover:bg-[#1a50d6] transition-all"
                >
                  <ExternalLink className="w-4 h-4" />
                  View in Task Tracker
                </Link>
                <button 
                  onClick={() => setShowSuccessModal(false)}
                  className="w-full py-3 px-4 text-slate-400 hover:text-slate-600 text-sm font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
