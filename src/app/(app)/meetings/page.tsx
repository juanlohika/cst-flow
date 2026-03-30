"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Loader2, Calendar, Users, QrCode, Play,
  FileText, CheckSquare, CheckCircle2, Search,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  UserPlus, Trash2, Clock, RefreshCw, Sparkles,
  X, User
} from "lucide-react";
import QRCode from "qrcode";
import AuthGuard from "@/components/auth/AuthGuard";
import GlobalBar from "@/components/layout/GlobalBar";
import { useToast } from "@/components/ui/ToastContext";
import { formatRef } from "@/lib/utils/format";
import StitchTimePicker from "@/components/ui/StitchTimePicker";

export default function MeetingHubPage() {
  return (
    <AuthGuard>
      <MeetingHubContent />
    </AuthGuard>
  );
}

interface Meeting {
  id: string;
  title: string;
  companyName?: string;
  meetingType: string;
  scheduledAt: string;
  status: string;
  attendees: any[];
  activeApps: string;
  qrCode?: string;
}

const STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-[#F1F7FF] text-[#2162F9] border-[#BFDBFE]",
  "in-progress": "bg-[#F1F7FF] text-[#2162F9] border-[#BFDBFE]", // Blue for in-progress
  completed: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]", // Green for completed
  cancelled: "bg-red-50 text-red-600 border-red-100",
};

const ATTENDANCE_STYLES: Record<string, string> = {
  expected: "bg-slate-100 text-slate-500",
  attended: "bg-green-50 text-green-700",
  absent: "bg-red-50 text-red-500",
};

const PAGE_SIZE = 15;
type SortKey = "title" | "companyName" | "scheduledAt" | "status";

function MeetingHubContent() {
  const router = useRouter(); // Fix 'router is not defined'
  const { showToast } = useToast();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewMeetingModal, setShowNewMeetingModal] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("scheduledAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => { loadMeetings(); }, []);

  const loadMeetings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meetings");
      if (res.ok) setMeetings(await res.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const filtered = useMemo(() => {
    let rows = meetings;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(m => m.title.toLowerCase().includes(q) || (m.companyName || "").toLowerCase().includes(q));
    }
    if (filterStatus) rows = rows.filter(m => m.status === filterStatus);
    if (filterType) rows = rows.filter(m => m.meetingType === filterType);
    
    // Date range filtering
    if (startDate) {
      const start = new Date(startDate);
      rows = rows.filter(m => new Date(m.scheduledAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      rows = rows.filter(m => new Date(m.scheduledAt) <= end);
    }

    rows = [...rows].sort((a, b) => {
      const av = (a[sortKey] as string) ?? "";
      const bv = (b[sortKey] as string) ?? "";
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return rows;
  }, [meetings, search, filterStatus, filterType, startDate, endDate, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      <GlobalBar breadcrumbs={[{ label: "AI Apps", href: "#" }, { label: "Meetings", href: "/meetings" }]} />
      
      {/* ── Tabs Bar (40px) ────────────────────────────────────────────────── */}
      <div className="h-[40px] flex-shrink-0 flex items-center justify-between border-b border-border-default px-4 bg-white">
        <div className="flex items-end h-full gap-4">
          {(["all", "scheduled", "in-progress", "completed"] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setFilterStatus(s === "all" ? "" : s); setPage(1); }}
              className={`h-full flex items-center px-1 text-[12px] border-b-2 transition-colors relative ${
                (s === "all" && !filterStatus) || filterStatus === s
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-text-secondary hover:text-text-primary font-regular"
              }`}
            >
              <span className="capitalize">{s.replace("-", " ")}</span>
              {(s === "all" && !filterStatus) || filterStatus === s ? (
                 <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
              ) : null}
            </button>
          ))}
        </div>
        <button 
          onClick={() => setShowNewMeetingModal(true)} 
          className="flex items-center gap-1.5 h-7 px-3 bg-primary text-white rounded-md text-[12px] font-bold shadow-sm hover:bg-primary/95 transition-all active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" strokeWidth={3} /> Add Meeting
        </button>
      </div>

      {/* ── Filter Bar (40px) ──────────────────────────────────────────────── */}
      <div className="h-[40px] flex-shrink-0 flex items-center gap-3 px-4 border-b border-border-default bg-surface-subtle/30">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" strokeWidth={2.5} />
          <input 
            type="text" 
            placeholder="Search by title or company…" 
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 h-7 border border-border-default rounded-md text-[12px] font-regular bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all" 
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest mr-1">Type:</span>
          <select 
            value={filterType} 
            onChange={e => { setFilterType(e.target.value); setPage(1); }}
            className="h-7 px-2 border border-border-default rounded-md text-[11px] font-bold bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            <option value="">All Types</option>
            <option value="kickoff">Kickoff</option>
            <option value="requirements-deep-dive">Requirements Deep-Dive</option>
            <option value="follow-up">Follow-Up</option>
          </select>
        </div>

        <div className="flex items-center gap-1">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest mr-1">Date Range:</span>
          <div className="flex items-center gap-1.5">
            <input 
              type="date" 
              value={startDate} 
              onChange={e => { setStartDate(e.target.value); setPage(1); }}
              className="h-7 px-2 border border-border-default rounded-md text-[11px] font-medium bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <span className="text-text-muted text-[10px]">—</span>
            <input 
              type="date" 
              value={endDate} 
              onChange={e => { setEndDate(e.target.value); setPage(1); }}
              className="h-7 px-2 border border-border-default rounded-md text-[11px] font-medium bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
        </div>

        {(search || filterType || startDate || endDate) && (
          <button 
            onClick={() => { setSearch(""); setFilterType(""); setStartDate(""); setEndDate(""); setPage(1); }} 
            className="text-[11px] font-bold text-text-muted hover:text-text-primary px-2 transition-colors uppercase tracking-widest"
          >
            Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
           <button onClick={loadMeetings} className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
           </button>
        </div>
      </div>

      {/* ── Main Content Area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto bg-white styled-scroll">
        <div className="min-w-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
                <span className="text-[12px] text-text-muted font-medium">Loading meetings…</span>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-center px-4">
               <div className="w-16 h-16 rounded-2xl bg-surface-muted flex items-center justify-center mb-4">
                 <Calendar className="w-8 h-8 text-text-muted opacity-40" />
               </div>
               <h3 className="text-[16px] font-bold text-text-primary">No meetings found</h3>
               <p className="text-[13px] text-text-secondary mt-1 max-w-xs mx-auto">
                 {search || filterStatus || filterType 
                   ? "Try adjusting your filters to find what you're looking for." 
                   : "Orchestrate your first live client meeting by clicking the Add button."}
               </p>
               {!search && !filterStatus && !filterType && (
                 <button 
                   onClick={() => setShowNewMeetingModal(true)}
                   className="mt-6 flex items-center gap-2 px-6 h-10 bg-primary text-white rounded-xl text-[13px] font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                 >
                   <Plus className="w-4 h-4" /> Create First Meeting
                 </button>
               )}
            </div>
          ) : (
            <>
              <table className="w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#FCFCFC] border-b border-border-default h-10">
                    <MeetingSortHeader label="Meeting Title" col="title" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <MeetingSortHeader label="Account" col="companyName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2 text-[11px] font-medium text-text-muted border-b border-border-default select-none">
                      <div className="flex items-center gap-1.5 uppercase tracking-wider">
                         <Sparkles className="w-3 h-3" /> Tools
                      </div>
                    </th>
                    <MeetingSortHeader label="Scheduled" col="scheduledAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2 text-[11px] font-medium text-text-muted border-b border-border-default select-none">
                      <div className="flex items-center gap-1.5 uppercase tracking-wider">
                         <Users className="w-3 h-3" /> Attendance
                      </div>
                    </th>
                    <MeetingSortHeader label="Status" col="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-3 py-2 text-[11px] font-medium text-text-muted border-b border-border-default text-right pr-4 select-none">
                       <span className="uppercase tracking-wider">Actions</span>
                    </th>
                  </tr>
                </thead>
                  <tbody>
                    {paginated.map(meeting => {
                      const scheduledDate = new Date(meeting.scheduledAt);
                      return (
                        <tr key={meeting.id} className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors group">
                          <td className="px-3 py-3">
                            <div className="flex flex-col">
                              <button onClick={() => setSelectedMeetingId(meeting.id)} className="font-medium text-[12px] text-text-primary hover:text-primary transition-colors text-left uppercase tracking-tight">
                                {meeting.title}
                              </button>
                              <span className="text-[10px] text-text-secondary mt-0.5">
                                REF: {formatRef(meeting.id, "MTG")}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 rounded bg-surface-muted flex items-center justify-center text-[10px] font-bold text-text-muted">
                                {meeting.companyName?.charAt(0) || "A"}
                              </div>
                              <span className="text-[12px] font-regular text-text-muted">{meeting.companyName || "Internal"}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 flex-wrap">
                              {(() => {
                                let apps = [];
                                try { apps = JSON.parse(meeting.activeApps || "[]"); } catch { apps = []; }
                                if (apps.length === 0) return <span className="text-[11px] text-text-secondary">none</span>;
                                return apps.map((a: string) => (
                                  <span key={a} className="p-1 px-1.5 bg-surface-muted text-text-muted text-[10px] font-bold uppercase rounded border border-border-default whitespace-nowrap">
                                    {a.replace("-maker", "").replace("-flow", "").replace("-manager", "tasks")}
                                  </span>
                                ));
                              })()}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col">
                              <span className="text-[12px] font-medium text-text-primary">{scheduledDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                              <span className="text-[11px] text-text-secondary">{scheduledDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-text-muted">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[12px] font-medium">{meeting.attendees?.length || 0}</span>
                              {(meeting.attendees?.length || 0) > 0 && <span className="text-[10px] opacity-60">participants</span>}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-medium ${STATUS_STYLES[meeting.status] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                              {meeting.status.replace("-", " ")}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right pr-4">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button 
                                onClick={() => router.push(`/meetings/${meeting.id}/live`)} 
                                className="p-1 h-7 w-7 flex items-center justify-center text-text-muted hover:text-primary transition-colors border border-border-default rounded-md bg-white shadow-sm"
                                title="Join Live Session"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                              </button>
                              <button 
                                onClick={() => setSelectedMeetingId(meeting.id)} 
                                className="p-1 h-7 w-7 flex items-center justify-center text-text-muted hover:text-primary transition-colors border border-border-default rounded-md bg-white shadow-sm"
                              >
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

              <div className="h-10 flex-shrink-0 flex items-center justify-between px-4 border-t border-border-default bg-[#FCFCFC] sticky bottom-0 z-10">
                <span className="text-[12px] text-text-muted font-medium">
                   Showing {filtered.length} meeting{filtered.length !== 1 ? "s" : ""}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-[11px] font-bold text-text-primary px-2">Page {page} of {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 text-text-muted hover:text-text-primary disabled:opacity-30">
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showNewMeetingModal && (
        <NewMeetingModal onClose={() => setShowNewMeetingModal(false)} onSuccess={() => { setShowNewMeetingModal(false); loadMeetings(); }} />
      )}
      {selectedMeetingId && (
        <MeetingDetailPanel meetingId={selectedMeetingId as string} loadMeetings={loadMeetings} onClose={() => { setSelectedMeetingId(null); loadMeetings(); }} />
      )}
    </div>
  );
}

function MeetingSortHeader({ label, col, sortKey, sortDir, onSort }: {
  label: string; col: SortKey; sortKey: SortKey; sortDir: "asc" | "desc"; onSort: (col: SortKey) => void;
}) {
  const active = sortKey === col;
  return (
    <th className="px-3 py-2 text-left border-b border-border-default select-none group">
      <button onClick={() => onSort(col)} className="flex items-center gap-1.5">
        <span className={`text-[11px] font-medium transition-colors uppercase tracking-wider ${active ? "text-primary" : "text-text-muted hover:text-text-primary"}`}>
          {label}
        </span>
        {active ? (
          sortDir === "asc" ? <ChevronUp className="w-3 h-3 text-primary" strokeWidth={2.5} /> : <ChevronDown className="w-3 h-3 text-primary" strokeWidth={2.5} />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-30" strokeWidth={2.5} />
        )}
      </button>
    </th>
  );
}

function StartMeetingButton({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.push(`/meetings/${meetingId}/live`)} title="Start meeting" className="p-1.5 rounded hover:bg-green-50 transition-colors text-green-600">
      <Play className="w-3.5 h-3.5" />
    </button>
  );
}

function NewMeetingModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"select-account" | "select-prep-type" | "details">("select-account");
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [existingPrepSession, setExistingPrepSession] = useState<any>(null);
  const [checkingPrep, setCheckingPrep] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [meetingTypes, setMeetingTypes] = useState<any[]>([]);
  const [availableApps, setAvailableApps] = useState<any[]>([]);
  
  const [formData, setFormData] = useState({
    title: "",
    meetingType: [] as string[],
    customAgenda: "",
    architectFlowEnabled: true,
    brdMakerEnabled: false,
    taskManagerEnabled: false,
    timelineMakerEnabled: false,
    zoomLink: "",
    activeApps: [] as string[],
    assignedIds: [] as string[],
    plannedStartTime: "09:00",
    plannedEndTime: "10:00",
    scheduledAt: new Date().toISOString().split("T")[0],
  });
  const [members, setMembers] = useState<{ users: any[] }>({ users: [] });

  useEffect(() => {
    fetch("/api/users/members")
      .then(r => r.ok ? r.json() : { users: [] })
      .then(setMembers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingAccounts(true);
    fetch("/api/accounts")
      .then(r => r.ok ? r.json() : [])
      .then(setAccounts)
      .catch(() => {})
      .finally(() => setLoadingAccounts(false));
    fetch("/api/projects")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setProjects(data); })
      .catch(() => {});
    fetch("/api/skills?category=meeting-prep")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setMeetingTypes(data); })
      .catch(() => {});
    fetch("/api/apps")
      .then(r => r.ok ? r.json() : [])
      .then(data => { if (Array.isArray(data)) setAvailableApps(data.filter((a: any) => a.isActive)); })
      .catch(() => {});
  }, []);

  const toggleMeetingType = (slug: string) => {
    setFormData(f => {
      const nextType = f.meetingType.includes(slug) ? f.meetingType.filter(t => t !== slug) : [...f.meetingType, slug];
      checkPrepStatus(nextType.join(","));
      return { ...f, meetingType: nextType };
    });
  };

  const checkPrepStatus = async (typeStr: string) => {
    setExistingPrepSession(null);
    if (!selectedAccount || !typeStr) return;
    setCheckingPrep(true);
    try {
      const res = await fetch(`/api/meeting-prep/sessions?clientProfileId=${selectedAccount.id}&meetingType=${typeStr}`);
      if (res.ok) {
        const data = await res.json();
        const found = Array.isArray(data) ? data[0] : null;
        setExistingPrepSession(found || null);
      }
    } catch { /* silent */ }
    setCheckingPrep(false);
  };

  const handleCreate = async () => {
    if (!formData.title.trim()) { showToast("Meeting title is required", "error"); return; }
    if (!selectedAccount) { showToast("Please select an account", "error"); return; }
    setLoading(true);
    try {
      // Map booleans to activeApps array (slugs used by the Live Room)
      const apps = [];
      if (formData.architectFlowEnabled) apps.push("architect-flow");
      if (formData.brdMakerEnabled) apps.push("brd-maker");
      if (formData.taskManagerEnabled) apps.push("task-manager");
      if (formData.timelineMakerEnabled) apps.push("timeline-maker");

      const body: any = {
        ...formData,
        activeApps: apps,
        meetingType: formData.meetingType.join(", "),
        companyName: selectedAccount.companyName,
        clientProfileId: selectedAccount.id,
        scheduledAt: new Date().toISOString(),
        projectId: selectedProjectId || null,
        assignedIds: formData.assignedIds,
        plannedStartTime: formData.plannedStartTime,
        plannedEndTime: formData.plannedEndTime,
      };
      if (existingPrepSession) body.meetingPrepSessionId = existingPrepSession.id;
      if (formData.customAgenda) body.customAgenda = formData.customAgenda;

      const res = await fetch("/api/meetings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed");
      showToast("Meeting created!", "success");
      onSuccess();
    } catch (err: any) {
      showToast(`Error: ${err.message}`, "error");
    } finally { setLoading(false); }
  };

  const stepLabel = step === "select-account"
    ? "Select client account"
    : step === "select-prep-type"
    ? `${selectedAccount?.companyName} — select meeting type`
    : `${selectedAccount?.companyName} — meeting details`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6 space-y-5">
        <div>
          <h2 className="text-[15px] font-semibold text-text-primary">Create Meeting</h2>
          <p className="text-[12px] text-text-secondary mt-1">{stepLabel}</p>
        </div>

        {step === "select-account" && (
          <div className="space-y-2 max-h-60 overflow-y-auto styled-scroll">
            {loadingAccounts ? (
              <div className="flex items-center justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>
            ) : accounts.length === 0 ? (
              <div className="text-center py-6 space-y-2">
                <p className="text-[13px] text-text-secondary">No accounts yet.</p>
                <p className="text-[12px] text-text-muted">Go to <strong>Accounts</strong> in the sidebar to add your first client.</p>
              </div>
            ) : accounts.map(account => (
              <button key={account.id}
                onClick={() => setSelectedAccount(account)}
                className={`w-full text-left px-4 py-3 rounded-md border-2 transition-colors ${selectedAccount?.id === account.id ? "border-primary bg-primary/5" : "border-border-default hover:border-primary/30"}`}
              >
                <p className="font-medium text-text-primary text-[13px]">{account.companyName}</p>
                <p className="text-[11px] text-text-secondary capitalize mt-0.5">{account.industry} · {account.engagementStatus}</p>
              </button>
            ))}
          </div>
        )}

        {step === "select-prep-type" && (
          <div className="space-y-3 max-h-80 overflow-y-auto styled-scroll pr-1">
            <div className="grid grid-cols-1 gap-2.5">
              {meetingTypes.map(mt => (
                <button key={mt.slug}
                  onClick={() => toggleMeetingType(mt.slug)}
                  className={`w-full text-left px-4 py-3 rounded-md border-2 transition-colors ${formData.meetingType.includes(mt.slug) ? "border-primary bg-primary/5" : "border-border-default hover:border-primary/30"}`}
                >
                  <div className="flex items-center gap-2">
                    <input type="checkbox" readOnly checked={formData.meetingType.includes(mt.slug)} className="rounded border-border-default text-primary focus:ring-primary pointer-events-none" />
                    <p className="font-medium text-text-primary text-[13px]">{mt.name}</p>
                  </div>
                  {mt.description && <p className="text-[11px] text-text-secondary mt-1 pl-5">{mt.description}</p>}
                </button>
              ))}
            </div>
            {formData.meetingType.length > 0 && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-[11px] ${existingPrepSession ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>
                {checkingPrep ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Checking prep status…</>
                ) : existingPrepSession ? (
                  <><CheckCircle2 className="w-3 h-3 flex-shrink-0" /> Prep package ready — will be linked automatically</>
                ) : (
                  <><Sparkles className="w-3 h-3 flex-shrink-0" /> No prep yet — generate it from the meeting&apos;s Preparation tab</>
                )}
              </div>
            )}
          </div>
        )}

        {step === "details" && (
          <div className="space-y-3 max-h-[70vh] overflow-y-auto styled-scroll px-1">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Meeting Title *</label>
              <input 
                type="text" 
                placeholder="Enter title..." 
                value={formData.title}
                onChange={e => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-semibold" 
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1">
                 <Calendar className="w-3 h-3 text-primary" /> Meeting Date
              </label>
              <input 
                type="date" 
                value={formData.scheduledAt} 
                onChange={e => setFormData({ ...formData, scheduledAt: e.target.value })}
                className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] bg-white outline-none focus:ring-2 focus:ring-primary/20 transition-all font-semibold" 
              />
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1">
                 <Clock className="w-3 h-3 text-primary" /> Time Window
              </label>
              <StitchTimePicker
                 defaultValue={{ start: formData.plannedStartTime, end: formData.plannedEndTime }}
                 onSelect={(s, e) => setFormData(prev => ({ ...prev, plannedStartTime: s, plannedEndTime: e }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-widest flex items-center gap-1">
                 <User className="w-3 h-3" /> Assign Team
              </label>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-surface-subtle border border-border-default rounded-md">
                  {formData.assignedIds.length === 0 && <span className="text-[11px] text-text-muted italic">No users assigned</span>}
                  {formData.assignedIds.map(id => {
                    const u = members.users.find(m => m.id === id);
                    return (
                      <div key={id} className="inline-flex items-center gap-1.5 bg-white border border-border-default px-2 py-0.5 rounded text-[11px]">
                        <span className="font-medium text-text-primary">{u?.name || "User"}</span>
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, assignedIds: prev.assignedIds.filter(aid => aid !== id) }))}
                          className="text-text-muted hover:text-red-500 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                
                <select
                  className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] bg-white cursor-pointer"
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val || formData.assignedIds.includes(val)) return;
                    setFormData(prev => ({ ...prev, assignedIds: [...prev.assignedIds, val] }));
                  }}
                >
                  <option value="">+ Add team member</option>
                  {members.users.map(u => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-primary mb-1.5">Manual Agenda <span className="font-normal text-text-muted">(optional)</span></label>
              <textarea 
                placeholder="What topics should be covered? (Your own ideas/inputs)" 
                value={formData.customAgenda}
                onChange={e => setFormData({ ...formData, customAgenda: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-border-default rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-all" 
              />
            </div>

            <div>
              <label className="block text-[12px] font-medium text-text-primary mb-1.5">Link to Project <span className="font-normal text-text-muted">(optional)</span></label>
              <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
                className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary">
                <option value="">No project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.companyName && p.companyName !== p.name ? ` — ${p.companyName}` : ""}</option>)}
              </select>
            </div>

            <div>
              <p className="text-[12px] font-medium text-text-primary mb-2">Enable Tools</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { key: "architectFlowEnabled", label: "Architect Flow" },
                  { key: "brdMakerEnabled", label: "BRD Maker" },
                  { key: "taskManagerEnabled", label: "Task Manager" },
                  { key: "timelineMakerEnabled", label: "Timeline Maker" }
                ].map(tool => (
                  <label key={tool.key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={(formData as any)[tool.key]} onChange={e => setFormData({ ...formData, [tool.key]: e.target.checked })} className="rounded border-border-default text-primary" />
                    <span className="text-[12px] text-text-primary">{tool.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium text-text-primary border border-border-default rounded-md hover:bg-surface-subtle transition-colors">Cancel</button>
          {step === "select-account" && (
            <button onClick={() => setStep("select-prep-type")} disabled={!selectedAccount}
              className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
              Next
            </button>
          )}
          {step === "select-prep-type" && (
            <>
              <button onClick={() => setStep("select-account")} className="px-4 py-2 text-[13px] font-medium text-text-primary border border-border-default rounded-md hover:bg-surface-subtle transition-colors">Back</button>
              <button onClick={() => setStep("details")} disabled={formData.meetingType.length === 0}
                className="px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
                Next
              </button>
            </>
          )}
          {step === "details" && (
            <>
              <button onClick={() => setStep("select-prep-type")} className="px-4 py-2 text-[13px] font-medium text-text-primary border border-border-default rounded-md hover:bg-surface-subtle transition-colors">Back</button>
              <button onClick={handleCreate} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type DetailTab = "preparation" | "overview" | "attendees" | "settings" | "outputs";

function MeetingDetailPanel({ meetingId, onClose, loadMeetings }: { meetingId: string; onClose: () => void; loadMeetings: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<DetailTab>("preparation");
  const [prep, setPrep] = useState<any>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [linkAccounts, setLinkAccounts] = useState<any[]>([]);
  const [linkAccountId, setLinkAccountId] = useState("");
  const [linkingAccount, setLinkingAccount] = useState(false);

  // Attendees state
  const [attendees, setAttendees] = useState<any[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ fullName: "", email: "", mobileNumber: "", companyName: "", position: "" });
  const [addingAttendee, setAddingAttendee] = useState(false);

  useEffect(() => { loadMeeting(); }, [meetingId]);
  useEffect(() => { if (tab === "attendees") loadAttendees(); }, [tab]);
  useEffect(() => { if (tab === "preparation" && meeting && !prep) loadPrep(); }, [tab, meeting]);

  const loadMeeting = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`);
      if (res.ok) {
        const data = await res.json();
        setMeeting(data);
        const qrUrl = `${window.location.origin}/meetings/attend/${data.id}`;
        QRCode.toDataURL(qrUrl, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  const loadPrep = async () => {
    if (meeting?.meetingPrepSession) {
      setPrep(meeting.meetingPrepSession);
      return;
    }
    if (!meeting?.meetingPrepSessionId && !meeting?.clientProfileId) {
      fetch("/api/accounts").then(r => r.ok ? r.json() : []).then(setLinkAccounts).catch(() => {});
      return;
    }
    setPrepLoading(true);
    try {
      if (meeting.meetingPrepSessionId) {
        const res = await fetch(`/api/meeting-prep/sessions?meetingPrepSessionId=${meeting.meetingPrepSessionId}`);
        if (res.ok) { const data = await res.json(); setPrep(Array.isArray(data) ? data[0] : data); }
      } else if (meeting.clientProfileId) {
        const res = await fetch(`/api/meeting-prep/sessions?clientProfileId=${meeting.clientProfileId}&meetingType=${meeting.meetingType}`);
        if (res.ok) { const data = await res.json(); setPrep(Array.isArray(data) ? data[0] : null); }
      }
    } catch { /* silent */ }
    setPrepLoading(false);
  };

  const linkAccount = async () => {
    if (!linkAccountId) return;
    setLinkingAccount(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientProfileId: linkAccountId }),
      });
      if (!res.ok) throw new Error("Failed");
      showToast("Account linked!", "success");
      setPrep(null);
      setLinkAccounts([]);
      await loadMeeting();
    } catch { showToast("Failed to link account", "error"); }
    setLinkingAccount(false);
  };

  const generatePrep = async () => {
    if (!meeting?.clientProfileId) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/meeting-prep/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientProfileId: meeting.clientProfileId, meetingType: meeting.meetingType }),
      });
      if (res.ok) { const data = await res.json(); setPrep(data); showToast("Prep package generated!", "success"); }
      else { const e = await res.json(); showToast(e.error || "Generation failed", "error"); }
    } catch { showToast("Network error", "error"); }
    setGenerating(false);
  };

  const loadAttendees = async () => {
    setAttendeesLoading(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/attendees`);
      if (res.ok) setAttendees(await res.json());
    } catch { /* silent */ }
    setAttendeesLoading(false);
  };

  const copyCheckInLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/meetings/attend/${meetingId}`);
    showToast("Check-in link copied", "success");
  };

  const addAttendee = async () => {
    if (!addForm.fullName.trim()) { showToast("Full name is required", "error"); return; }
    setAddingAttendee(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/attendees`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      showToast("Attendee added", "success");
      setAddForm({ fullName: "", email: "", mobileNumber: "", companyName: "", position: "" });
      setShowAddForm(false);
      loadAttendees();
    } catch (err: any) {
      showToast(err.message, "error");
    } finally { setAddingAttendee(false); }
  };

  const updateStatus = async (attendeeId: string, attendanceStatus: string) => {
    try {
      await fetch(`/api/meetings/${meetingId}/attendees/${attendeeId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceStatus }),
      });
      setAttendees(prev => prev.map(a => a.id === attendeeId ? { ...a, attendanceStatus } : a));
    } catch { showToast("Failed to update status", "error"); }
  };

  const removeAttendee = async (attendeeId: string) => {
    try {
      await fetch(`/api/meetings/${meetingId}/attendees/${attendeeId}`, { method: "DELETE" });
      setAttendees(prev => prev.filter(a => a.id !== attendeeId));
    } catch { showToast("Failed to remove attendee", "error"); }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded-lg"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-end z-[999]">
      <div className="bg-white w-full max-w-lg h-screen flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-default flex-shrink-0 bg-white">
          <div className="min-w-0 pr-4">
            <h2 className="text-[18px] font-semibold text-text-primary truncate">{meeting?.title}</h2>
            {meeting?.companyName && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[12px] font-medium text-text-secondary">{meeting.companyName}</span>
                <span className="w-1 h-1 rounded-full bg-border-default" />
                <span className="text-[10px] text-text-muted">
                  REF: {formatRef(meetingId, "MTG")}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
             {(meeting?.status === "scheduled" || meeting?.status === "in-progress") && (
               <button 
                onClick={() => router.push(`/meetings/${meetingId}/live`)}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-xl text-[12px] font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all whitespace-nowrap"
               >
                 <Play className="w-3.5 h-3.5 fill-current" /> Join Live
               </button>
             )}
             <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
               <X className="w-5 h-5 text-slate-400" />
             </button>
          </div>
        </div>

        <div className="flex border-b border-border-default flex-shrink-0 bg-white shadow-sm">
          {(["preparation", "overview", "attendees", "settings", "outputs"] as (DetailTab | "settings")[]).map(t => (
            <button key={t} onClick={() => setTab(t as any)}
              className={`flex-1 px-4 py-3 text-[12px] transition-colors relative ${
                tab === t 
                  ? "text-primary font-medium" 
                  : "text-text-secondary hover:text-text-primary font-regular"
              }`}>
              <span className="capitalize">{t}</span>
              {tab === t && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto styled-scroll bg-white">
          {tab === "preparation" && <PreparationTab meeting={meeting} prep={prep} prepLoading={prepLoading} generating={generating} generatePrep={generatePrep} linkAccounts={linkAccounts} linkAccountId={linkAccountId} setLinkAccountId={setLinkAccountId} linkAccount={linkAccount} linkingAccount={linkingAccount} />}
          {tab === "overview" && <OverviewTab meeting={meeting} scheduledAt={meeting.scheduledAt} qrDataUrl={qrDataUrl} copyCheckInLink={copyCheckInLink} />}
          {tab === "attendees" && <AttendeesTab attendees={attendees} attendeesLoading={attendeesLoading} showAddForm={showAddForm} setShowAddForm={setShowAddForm} addForm={addForm} setAddForm={setAddForm} addingAttendee={addingAttendee} addAttendee={addAttendee} updateStatus={updateStatus} removeAttendee={removeAttendee} />}
          {tab === "settings" && <MeetingSettingsTab meeting={meeting} onUpdate={() => { loadMeeting(); loadMeetings(); }} />}
          {tab === "outputs" && <OutputsTab meetingId={meetingId} />}
        </div>
      </div>
    </div>
  );
}

function PreparationTab({ meeting, prep, prepLoading, generating, generatePrep, linkAccounts, linkAccountId, setLinkAccountId, linkAccount, linkingAccount }: any) {
    if (prepLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
    if (!meeting?.clientProfileId) {
        return (
            <div className="p-5 space-y-4">
                <div className="text-center py-8 space-y-1 opacity-40">
                    <FileText className="w-6 h-6 mx-auto" />
                    <p className="text-[13px]">No account linked to this meeting.</p>
                </div>
                {linkAccounts.length > 0 && (
                    <div className="border border-border-default rounded-lg p-4 space-y-3 bg-surface-subtle">
                        <p className="text-[12px] font-semibold text-text-primary">Link account to enable AI prep</p>
                        <select value={linkAccountId} onChange={e => setLinkAccountId(e.target.value)}
                            className="w-full px-3 py-2 border border-border-default rounded-md text-[12px] focus:outline-none focus:ring-2 focus:ring-primary shadow-sm bg-white">
                            <option value="">Select account…</option>
                            {linkAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.companyName}</option>)}
                        </select>
                        <button onClick={linkAccount} disabled={!linkAccountId || linkingAccount}
                            className="w-full py-2 bg-primary text-white rounded-md text-[12px] font-medium hover:bg-primary-hover disabled:opacity-50 transition-all shadow-sm">
                            {linkingAccount ? "Linking..." : "Confirm Account"}
                        </button>
                    </div>
                )}
            </div>
        );
    }
    if (!prep) {
        return (
            <div className="p-5 text-center py-12 space-y-3">
                <Sparkles className="w-8 h-8 mx-auto text-primary opacity-20" />
                <p className="text-[13px] text-text-secondary">AI knowledge package hasn't been generated yet.</p>
                <button onClick={generatePrep} disabled={generating}
                    className="inline-flex items-center gap-2 px-6 py-2 bg-primary text-white rounded-md text-[12px] font-semibold shadow-md">
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {generating ? "Spinning AI Intelligence..." : "Synthesize AI Prep"}
                </button>
            </div>
        );
    }
    
    return (
        <div className="p-5 space-y-6">
            <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-200">Package Ready</span>
                <button onClick={generatePrep} disabled={generating} className="text-[12px] text-primary hover:text-primary/80 font-medium disabled:opacity-50 flex items-center gap-1.5 transition-colors">
                   {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 
                   {generating ? "Updating..." : "Regenerate"}
                </button>
            </div>
            {/* Show sections if available */}
            {prep.agendaContent && <PrepSection title="Agenda" content={prep.agendaContent} icon={<Clock className="w-3.5 h-3.5 text-text-muted" />} />}
            {prep.preparationChecklist && <PrepSection title="Checklist" content={prep.preparationChecklist} icon={<CheckCircle2 className="w-3.5 h-3.5 text-text-muted" />} />}
        </div>
    );
}

function OverviewTab({ meeting, scheduledAt, qrDataUrl, copyCheckInLink }: any) {
    const date = new Date(scheduledAt);
    return (
        <div className="p-5 space-y-6">
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 p-3 bg-surface-subtle rounded-xl border border-border-default">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Scheduled</p>
                    <p className="text-[13px] font-bold text-text-primary">{date.toLocaleDateString()}</p>
                    <p className="text-[11px] text-text-secondary">{date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
                <div className="space-y-1 p-3 bg-surface-subtle rounded-xl border border-border-default">
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">Type</p>
                    <p className="text-[13px] font-bold text-text-primary capitalize">{meeting.meetingType.replace(/-/g, ' ')}</p>
                    <p className="text-[11px] text-text-secondary">Official {meeting.meetingType.includes('kickoff') ? 'Start' : 'Session'}</p>
                </div>
            </div>
            
            <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 flex items-center justify-between gap-4">
               <div className="space-y-1 flex-1">
                   <p className="text-[12px] font-bold text-primary italic uppercase tracking-wider">Fast Check-In QR</p>
                   <p className="text-[11px] text-text-secondary leading-tight">Allow guests to scan and register instantly</p>
                   <button onClick={copyCheckInLink} className="text-[10px] font-black uppercase text-text-muted hover:text-primary mt-2 flex items-center gap-1 transition-colors">
                      <QrCode className="w-3 h-3" /> Copy Link
                   </button>
               </div>
               {qrDataUrl && <img src={qrDataUrl} className="w-20 h-20 rounded-lg shadow-sm border border-white" />}
            </div>
        </div>
    );
}

function AttendeesTab({ attendees, attendeesLoading, showAddForm, setShowAddForm, addForm, setAddForm, addingAttendee, addAttendee, updateStatus, removeAttendee }: any) {
    return (
        <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
                <p className="text-[12px] font-black uppercase tracking-widest text-text-muted">{attendees.length} Attendees</p>
                <button onClick={() => setShowAddForm(!showAddForm)} className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1 uppercase tracking-wider">
                    <Plus className="w-3 h-3" /> Add Guest
                </button>
            </div>
            {showAddForm && (
                <div className="p-4 border border-primary/20 bg-primary/5 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2">
                    <input autoFocus placeholder="Full Name" value={addForm.fullName} onChange={e => setAddForm({...addForm, fullName: e.target.value})} className="w-full bg-white border border-border-default px-3 py-2 rounded-xl text-[12px] outline-none shadow-sm" />
                    <input placeholder="Email Address" value={addForm.email} onChange={e => setAddForm({...addForm, email: e.target.value})} className="w-full bg-white border border-border-default px-3 py-2 rounded-xl text-[12px] outline-none shadow-sm" />
                    <div className="flex gap-2">
                        <button onClick={addAttendee} disabled={addingAttendee} className="flex-1 py-2 bg-primary text-white rounded-xl text-[12px] font-bold shadow-md shadow-primary/20">
                            {addingAttendee ? "Adding..." : "Add to List"}
                        </button>
                        <button onClick={() => setShowAddForm(false)} className="px-4 py-2 text-text-muted text-[12px]">Cancel</button>
                    </div>
                </div>
            )}
            
            <div className="space-y-2">
                {attendees.map((a: any) => (
                    <div key={a.id} className="p-3 bg-white border border-border-default rounded-2xl flex items-center justify-between group hover:border-primary/30 transition-all hover:shadow-lg hover:shadow-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-surface-muted flex items-center justify-center text-[10px] font-black text-text-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors uppercase">
                                {a.fullName.charAt(0)}
                            </div>
                            <div>
                                <p className="text-[12px] font-bold text-text-primary">{a.fullName}</p>
                                <p className="text-[10px] text-text-secondary lowercase italic">{a.email || "No email"}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <select value={a.attendanceStatus} onChange={e => updateStatus(a.id, e.target.value)} className={`text-[10px] font-black uppercase tracking-tighter px-2 py-1 rounded-lg border cursor-pointer outline-none ${ATTENDANCE_STYLES[a.attendanceStatus] || "bg-slate-50 border-slate-200 text-slate-400"}`}>
                                <option value="expected">Expected</option>
                                <option value="attended">Attended</option>
                                <option value="absent">Absent</option>
                            </select>
                            <button onClick={() => removeAttendee(a.id)} className="p-1.5 opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500">
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function MeetingSettingsTab({ meeting, onUpdate }: { meeting: any; onUpdate: () => void }) {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  
  const activeApps = useMemo(() => {
    try { 
      const parsed = typeof meeting.activeApps === "string" ? JSON.parse(meeting.activeApps || "[]") : meeting.activeApps;
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }, [meeting.activeApps]);

  const toggleApp = async (appSlug: string) => {
    setSaving(true);
    const nextApps = activeApps.includes(appSlug)
      ? activeApps.filter((a: string) => a !== appSlug)
      : [...activeApps, appSlug];
    
    try {
      const res = await fetch(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeApps: nextApps })
      });
      if (res.ok) {
        showToast("Tool settings updated", "success");
        onUpdate();
      } else {
        const data = await res.json();
        showToast(data.error || "Update failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setSaving(false);
    }
  };

  const tools = [
    { id: "brd-maker", label: "BRD Maker", desc: "Extract business requirements and interactive questions." },
    { id: "architect-flow", label: "Architect Flow", desc: "Generate process flowcharts from transcript." },
    { id: "task-manager", label: "Task Manager", desc: "Capture action items and assign owners." },
    { id: "timeline-maker", label: "Timeline Maker", desc: "Auto-generate project timelines from discussion." },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-[10px] font-black uppercase tracking-widest text-text-muted mb-4 px-1">AI Facilitation Tools</h3>
        <div className="grid grid-cols-1 gap-3">
          {tools.map(tool => {
            const enabled = activeApps.includes(tool.id);
            return (
              <button 
                key={tool.id}
                onClick={() => toggleApp(tool.id)}
                disabled={saving}
                className={`flex items-center justify-between p-4 rounded-2xl border transition-all text-left group ${
                  enabled ? "border-primary bg-primary/[0.03] shadow-sm" : "border-border-default hover:border-primary/30"
                }`}
              >
                <div className="space-y-1">
                  <p className={`text-[13px] font-bold transition-colors ${enabled ? "text-primary" : "text-text-primary group-hover:text-primary"}`}>
                    {tool.label}
                  </p>
                  <p className="text-[11px] text-text-muted leading-tight">{tool.desc}</p>
                </div>
                <div className={`w-10 h-5 rounded-full relative transition-all duration-300 ${enabled ? "bg-primary" : "bg-slate-200"}`}>
                  <div className={`absolute top-1 w-3 h-3 bg-white rounded-full shadow-sm transition-all duration-300 ${enabled ? "right-1" : "left-1"}`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
        <p className="text-[11px] text-text-muted leading-relaxed font-medium">
          <Sparkles className="w-3 h-3 inline-block mr-1 text-primary opacity-60" />
          Settings are synced in real-time. If you are already in a live session, the sidebar will update automatically when a tool is toggled.
        </p>
      </div>
    </div>
  );
}

function PrepSection({ title, content, icon }: any) {
    let data = [];
    try { 
        data = typeof content === 'string' ? JSON.parse(content) : content; 
        if (!Array.isArray(data)) data = [content];
    } catch { 
        data = [content]; 
    }
    if (data.length === 0) return null;
    
    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 px-1">
                <div className="p-1 px-1.5 bg-surface-subtle border border-border-default rounded text-text-muted">
                    {icon}
                </div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted">{title}</p>
            </div>
            <div className="space-y-3 pl-4 border-l-2 border-slate-100 ml-4">
                {data.map((item: any, i: number) => (
                    <div key={i} className="text-[12px] text-text-secondary leading-relaxed flex gap-3 group">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/10 mt-1.5 group-hover:bg-primary/40 transition-colors flex-shrink-0" />
                        <span className="group-hover:text-text-primary transition-colors">{typeof item === 'string' ? item : item.topic || item.task}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function OutputsTab({ meetingId }: { meetingId: string }) {
    return (
        <div className="p-12 text-center space-y-4">
            <div className="w-16 h-16 bg-surface-muted rounded-full flex items-center justify-center mx-auto border border-border-default">
                <FileText className="w-6 h-6 text-text-muted opacity-40" />
            </div>
            <div>
                <p className="text-[14px] font-bold text-text-primary uppercase tracking-tight">No Outputs Yet</p>
                <p className="text-[12px] text-text-secondary mt-1 max-w-[240px] mx-auto leading-relaxed">
                    Meeting minutes, BRD documents, and task lists will appear here after the session is completed.
                </p>
            </div>
        </div>
    );
}
