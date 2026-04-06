"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import * as htmlToImage from "html-to-image";
import {
  Plus, Loader2, CheckCircle2, ChevronRight,
  Building2, Layers, ArrowLeft, Sparkles, CalendarCheck,
  FileText, ClipboardList, Search, Pencil, ChevronLeft,
  ChevronDown, ChevronUp, User, BarChart2, GitBranch,
  FolderOpen, ExternalLink, Clock, Users, Paintbrush, Download,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/ToastContext";
import { formatRef } from "@/lib/utils/format";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import InteractiveGantt from "@/components/timeline/InteractiveGantt";
import BufferModal from "@/components/timeline/BufferModal";
import ProjectSettingsModal from "@/components/projects/ProjectSettingsModal";
import { Share, Mail, Copy, Check, X, Settings } from "lucide-react";


const WorkflowCanvas = dynamic(() => import("@/components/flow/WorkflowCanvas"), { ssr: false });
const MermaidChart = dynamic(() => import("@/components/flow/MermaidChart"), { ssr: false });

export default function MeetingPrepPage() {
  return (
    <AuthGuard>
      <MeetingPrepContent />
    </AuthGuard>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClientProfile {
  id: string;
  companyName: string;
  industry: string;
  modulesAvailed: string;
  engagementStatus: string;
  primaryContact?: string;
  primaryContactEmail?: string;
  specialConsiderations?: string;
  updatedAt: string;
  meetingPrepSessions?: PrepSession[];
}

interface PrepSession {
  id: string;
  meetingType: string;
  status: string;
  updatedAt: string;
  agendaContent?: string;
  questionnaireContent?: string;
  preparationChecklist?: string;
  anticipatedRequirements?: string;
  discussionGuide?: string;
}

const INDUSTRY_OPTIONS = [
  { value: "retail", label: "Retail" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "logistics", label: "Logistics" },
  { value: "healthcare", label: "Healthcare" },
  { value: "financial-services", label: "Financial Services" },
  { value: "food-and-beverage", label: "Food & Beverage" },
  { value: "general", label: "General / Other" },
];

const MODULE_OPTIONS = [
  { id: "crm", label: "CRM" },
  { id: "erp", label: "ERP" },
  { id: "inventory", label: "Inventory" },
  { id: "analytics", label: "Analytics & BI" },
  { id: "automation", label: "Process Automation" },
  { id: "hr", label: "HR & Payroll" },
  { id: "finance", label: "Finance & Accounting" },
  { id: "field-ops", label: "Field Operations" },
];

const INDUSTRY_ICONS: Record<string, any> = {
  retail: <Building2 className="w-3.5 h-3.5 text-blue-500" />,
  manufacturing: <Layers className="w-3.5 h-3.5 text-orange-500" />,
  logistics: <Layers className="w-3.5 h-3.5 text-emerald-500" />,
  healthcare: <ClipboardList className="w-3.5 h-3.5 text-red-500" />,
  "financial-services": <BarChart2 className="w-3.5 h-3.5 text-purple-500" />,
  "food-and-beverage": <Paintbrush className="w-3.5 h-3.5 text-amber-500" />,
  general: <Building2 className="w-3.5 h-3.5 text-slate-500" />,
};

const MEETING_TYPES = [
  { value: "kickoff", label: "Kickoff Meeting", desc: "First meeting — set scope, tone, and timeline" },
  { value: "requirements-deep-dive", label: "Requirements Deep-Dive", desc: "Detailed requirements gathering session" },
  { value: "follow-up", label: "Follow-Up", desc: "Progress check and issue resolution" },
];

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-[#F0FDF4] text-[#16A34A] border-[#BBF7D0]",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  exploratory: "bg-[#F1F7FF] text-[#2162F9] border-[#BFDBFE]",
};

const PAGE_SIZE = 15;

const EMPTY_FORM = {
  companyName: "",
  industry: "general",
  modulesAvailed: [] as string[],
  engagementStatus: "confirmed",
  primaryContact: "",
  primaryContactEmail: "",
  specialConsiderations: "",
};

// ─── Main Content ──────────────────────────────────────────────────────────────

function MeetingPrepContent() {
  const { showToast } = useToast();
  const [view, setView] = useState<"list" | "form" | "profile-detail">("list");
  const [editingProfile, setEditingProfile] = useState<ClientProfile | null>(null);
  const [profiles, setProfiles] = useState<ClientProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  // Table filters + pagination
  const [search, setSearch] = useState("");
  const [filterIndustry, setFilterIndustry] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<"companyName" | "industry" | "updatedAt">("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [formData, setFormData] = useState(EMPTY_FORM);

  useEffect(() => { loadProfiles(); }, []);

  const loadProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meeting-prep/profiles");
      if (res.ok) setProfiles(await res.json());
    } catch { /* silent */ }
    setLoading(false);
  };

  // ── Filtered / sorted / paged list ──────────────────────────────────────────

  const filtered = useMemo(() => {
    let rows = profiles;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p.companyName.toLowerCase().includes(q) ||
        (p.primaryContact || "").toLowerCase().includes(q)
      );
    }
    if (filterIndustry) rows = rows.filter(p => p.industry === filterIndustry);
    if (filterStatus) rows = rows.filter(p => p.engagementStatus === filterStatus);

    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] as string;
      const bv = b[sortKey] as string;
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    return rows;
  }, [profiles, search, filterIndustry, filterStatus, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  // ── Form actions ────────────────────────────────────────────────────────────

  const openNew = () => {
    setEditingProfile(null);
    setFormData(EMPTY_FORM);
    setView("form");
  };

  const openEdit = (profile: ClientProfile) => {
    setEditingProfile(profile);
    setFormData({
      companyName: profile.companyName,
      industry: profile.industry,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed); } catch { return []; } })(),
      engagementStatus: profile.engagementStatus,
      primaryContact: profile.primaryContact || "",
      primaryContactEmail: profile.primaryContactEmail || "",
      specialConsiderations: profile.specialConsiderations || "",
    });
    setView("form");
  };

  const handleSaveProfile = async () => {
    if (!formData.companyName.trim()) { showToast("Company name is required", "error"); return; }
    setSavingProfile(true);
    try {
      if (editingProfile) {
        const res = await fetch(`/api/meeting-prep/profiles/${editingProfile.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) throw new Error("Failed to update profile");
        showToast("Profile updated", "success");
        // Refresh selected profile if it's the one being edited
        if (selectedProfile?.id === editingProfile.id) {
          const updated = await res.json();
          setSelectedProfile({ ...selectedProfile, ...updated, meetingPrepSessions: selectedProfile.meetingPrepSessions });
        }
      } else {
        const res = await fetch("/api/meeting-prep/profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (!res.ok) throw new Error("Failed to create profile");
        showToast("Account created", "success");
      }
      setView("list");
      setFormData(EMPTY_FORM);
      setEditingProfile(null);
      loadProfiles();
    } catch {
      showToast("Error saving profile", "error");
    }
    setSavingProfile(false);
  };

  const openProfile = (profile: ClientProfile) => {
    setSelectedProfile(profile);
    setView("profile-detail");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const isEditing = !!editingProfile;

  // STABILITY: Integrated Central Navigation
  useBreadcrumbs(
    [
      { label: "AI Apps", href: "#" },
      { label: "Accounts", href: "/accounts" },
      ...(view === "form" ? [{ label: isEditing ? "Edit Account" : "New Account", href: "#" }] : []),
      ...(view === "profile-detail" && selectedProfile ? [{ label: selectedProfile.companyName, href: "#" }] : []),
    ]
  );

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">

      {view === "list" && (
        <>
          {/* ── Tabs Bar (40px) ────────────────────────────────────────────────── */}
          <div className="h-[40px] flex-shrink-0 flex items-center justify-between border-b border-border-default px-4 bg-white">
            <div className="flex items-end h-full gap-4">
              {(["all", "confirmed", "pending", "exploratory"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setFilterStatus(s === "all" ? "" : s); setPage(1); }}
                  className={`h-full flex items-center px-1 text-[12px] border-b-2 transition-colors relative ${
                    (s === "all" && !filterStatus) || filterStatus === s
                      ? "border-primary text-primary font-medium"
                      : "border-transparent text-text-secondary hover:text-text-primary font-regular"
                  }`}
                >
                  <span className="capitalize">{s}</span>
                  {(s === "all" && !filterStatus) || filterStatus === s ? (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />
                  ) : null}
                </button>
              ))}
            </div>
            <button 
              onClick={openNew} 
              className="flex items-center gap-1.5 h-7 px-3 bg-primary text-white rounded-md text-[12px] font-bold shadow-sm hover:bg-primary/95 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={3} /> New Account
            </button>
          </div>

          {/* ── Filter Bar (40px) ──────────────────────────────────────────────── */}
          <div className="h-[40px] flex-shrink-0 flex items-center gap-3 px-4 border-b border-border-default bg-surface-subtle/30">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" strokeWidth={2.5} />
              <input 
                type="text" 
                placeholder="Search by company or contact…" 
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-3 h-7 border border-border-default rounded-md text-[12px] font-regular bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/40 transition-all" 
              />
            </div>

            <div className="flex items-center gap-1">
              <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest mr-1">Industry:</span>
              <select 
                value={filterIndustry} 
                onChange={e => { setFilterIndustry(e.target.value); setPage(1); }}
                className="h-7 px-2 border border-border-default rounded-md text-[11px] font-bold bg-white focus:outline-none focus:ring-1 focus:ring-primary/40"
              >
                <option value="">All Industries</option>
                {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {(search || filterIndustry || filterStatus) && (
              <button 
                onClick={() => { setSearch(""); setFilterIndustry(""); setFilterStatus(""); setPage(1); }} 
                className="text-[11px] font-bold text-text-muted hover:text-text-primary px-2 transition-colors uppercase tracking-widest"
              >
                Clear
              </button>
            )}

            <div className="ml-auto flex items-center gap-2">
               <button onClick={loadProfiles} className="p-1.5 text-text-muted hover:text-text-primary transition-colors">
                  <Loader2 className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
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
                    <span className="text-[12px] text-text-muted font-medium">Loading accounts…</span>
                  </div>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-32 text-center px-4">
                  <div className="w-16 h-16 rounded-2xl bg-surface-muted flex items-center justify-center mb-4">
                    <Building2 className="w-8 h-8 text-text-muted opacity-40" />
                  </div>
                  <h3 className="text-[16px] font-bold text-text-primary">No accounts found</h3>
                  <p className="text-[13px] text-text-secondary mt-1 max-w-xs mx-auto">
                    Manage your client portfolio and preparation packages from one place.
                  </p>
                  {!search && !filterStatus && !filterIndustry && (
                    <button 
                      onClick={openNew}
                      className="mt-6 flex items-center gap-2 px-6 h-10 bg-primary text-white rounded-xl text-[13px] font-bold shadow-lg shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
                    >
                      <Plus className="w-4 h-4" /> Create First Account
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <table className="w-full text-left border-separate border-spacing-0">
                    <thead>
                      <tr className="bg-[#FCFCFC] border-b border-border-default h-10">
                        <SortHeader label="Company / Account" col="companyName" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <SortHeader label="Industry" col="industry" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="px-3 py-2 text-[11px] font-bold text-text-muted border-b border-border-default select-none uppercase tracking-widest">Modules</th>
                        <th className="px-3 py-2 text-[11px] font-bold text-text-muted border-b border-border-default select-none uppercase tracking-widest">Status</th>
                        <th className="px-3 py-2 text-[11px] font-bold text-text-muted border-b border-border-default select-none uppercase tracking-widest">Preps</th>
                        <SortHeader label="Updated" col="updatedAt" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
                        <th className="px-3 py-2 text-[11px] font-bold text-text-muted border-b border-border-default text-right pr-4 select-none uppercase tracking-widest">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map((profile) => {
                        const modules: string[] = (() => { try { return JSON.parse(profile.modulesAvailed); } catch { return []; } })();
                        const sessions = profile.meetingPrepSessions || [];
                        const readyCount = sessions.filter(s => s.status === "ready").length;

                        return (
                          <tr key={profile.id} className="border-b border-border-default last:border-0 hover:bg-surface-subtle transition-colors group">
                            <td className="px-3 py-3">
                              <button onClick={() => openProfile(profile)} className="flex items-center gap-2.5 text-left group">
                                <div className="w-7 h-7 rounded bg-surface-muted flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-text-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                  {profile.companyName.charAt(0)}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-[13px] text-text-primary group-hover:text-primary transition-colors truncate leading-tight">{profile.companyName}</p>
                                  <span className="text-[10px] text-text-secondary mt-0.5 block">
                                    REF: {formatRef(profile.id, "ACCT")}
                                  </span>
                                </div>
                              </button>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-regular text-text-secondary">
                                  {profile.industry.replace("-", " ")}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1 flex-wrap">
                                {modules.slice(0, 2).map((m: string) => (
                                  <span key={m} className="px-1.5 py-0.5 bg-surface-muted text-text-muted text-[10px] font-bold uppercase rounded border border-border-default">
                                    {m}
                                  </span>
                                ))}
                                {modules.length > 2 && <span className="text-[10px] text-text-muted">+{modules.length - 2}</span>}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                               <div className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-medium ${STATUS_STYLES[profile.engagementStatus] || "bg-slate-50 text-slate-500 border-slate-200"}`}>
                                 {profile.engagementStatus}
                               </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className={`text-[12px] font-medium ${readyCount === sessions.length && sessions.length > 0 ? "text-[#16A34A]" : "text-text-primary"}`}>
                                  {readyCount}/{sessions.length}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-text-muted">
                              <div className="flex flex-col">
                                <span className="text-[12px] font-medium text-text-primary">{new Date(profile.updatedAt).toLocaleDateString()}</span>
                                <span className="text-[11px] text-text-secondary">{new Date(profile.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right pr-4">
                              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => openEdit(profile)} className="p-1 h-7 w-7 flex items-center justify-center text-text-muted hover:text-primary transition-colors border border-border-default rounded-md bg-white shadow-sm">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button onClick={() => openProfile(profile)} className="p-1 h-7 w-7 flex items-center justify-center text-text-muted hover:text-primary transition-colors border border-border-default rounded-md bg-white shadow-sm">
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
                       Showing {filtered.length} account{filtered.length !== 1 ? "s" : ""}
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
        </>
      )}

      {/* ── CREATE / EDIT FORM ──────────────────────────────────────────── */}
      {view === "form" && (
        <div className="flex-1 overflow-auto bg-white styled-scroll">
          <div className="max-w-2xl mx-auto p-6">
            <button onClick={() => { setView("list"); setEditingProfile(null); }} className="flex items-center gap-1.5 text-[12px] text-text-secondary hover:text-text-primary mb-5 transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to list
            </button>

            <div className="mb-6">
              <h2 className="text-lg font-semibold text-text-primary">{isEditing ? `Edit — ${editingProfile!.companyName}` : "New Account"}</h2>
              <p className="text-[13px] text-text-secondary mt-1">{isEditing ? "Update the account details." : "Capture the account details so the facilitator is prepared for every meeting."}</p>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-[12px] font-medium text-text-primary mb-1.5">Company Name <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={formData.companyName}
                  onChange={e => setFormData(f => ({ ...f, companyName: e.target.value }))}
                  placeholder="e.g. Acme Corporation"
                  className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-text-primary mb-1.5">Industry</label>
                  <select
                    value={formData.industry}
                    onChange={e => setFormData(f => ({ ...f, industry: e.target.value }))}
                    className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {INDUSTRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-primary mb-1.5">Engagement Status</label>
                  <select
                    value={formData.engagementStatus}
                    onChange={e => setFormData(f => ({ ...f, engagementStatus: e.target.value }))}
                    className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="pending">Pending</option>
                    <option value="exploratory">Exploratory</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-text-primary mb-2">Modules Availed</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODULE_OPTIONS.map(mod => (
                    <label key={mod.id} className={`flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors ${formData.modulesAvailed.includes(mod.id) ? "border-primary bg-primary/5 text-primary" : "border-border-default hover:bg-surface-subtle"}`}>
                      <input
                        type="checkbox"
                        checked={formData.modulesAvailed.includes(mod.id)}
                        onChange={e => {
                          const updated = e.target.checked
                            ? [...formData.modulesAvailed, mod.id]
                            : formData.modulesAvailed.filter(m => m !== mod.id);
                          setFormData(f => ({ ...f, modulesAvailed: updated }));
                        }}
                        className="sr-only"
                      />
                      <span className="text-[12px] font-medium">{mod.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[12px] font-medium text-text-primary mb-1.5">Primary Contact</label>
                  <input
                    type="text"
                    value={formData.primaryContact}
                    onChange={e => setFormData(f => ({ ...f, primaryContact: e.target.value }))}
                    placeholder="Name"
                    className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-text-primary mb-1.5">Email</label>
                  <input
                    type="email"
                    value={formData.primaryContactEmail}
                    onChange={e => setFormData(f => ({ ...f, primaryContactEmail: e.target.value }))}
                    placeholder="email@company.com"
                    className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[12px] font-medium text-text-primary mb-1.5">Notes from Acquisition Team</label>
                <textarea
                  value={formData.specialConsiderations}
                  onChange={e => setFormData(f => ({ ...f, specialConsiderations: e.target.value }))}
                  placeholder="Any urgency, known pain points, decision-maker preferences, or context from the sales conversation..."
                  rows={4}
                  className="w-full px-3 py-2 border border-border-default rounded-md text-[13px] focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2 font-regular">
                <button onClick={() => { setView("list"); setEditingProfile(null); }} className="px-4 py-2 text-[13px] font-medium text-text-primary border border-border-default rounded-md hover:bg-surface-subtle transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSaveProfile}
                  disabled={savingProfile || !formData.companyName.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-md text-[13px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {savingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {savingProfile ? "Saving…" : isEditing ? "Save Changes" : "Save Profile"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ACCOUNT HUB (5-TAB) ─────────────────────────────────────────── */}
      {view === "profile-detail" && selectedProfile && (
        <AccountHub
          profile={selectedProfile}
          onEdit={() => openEdit(selectedProfile)}
          onBack={() => { setView("list"); setSelectedProfile(null); }}
        />
      )}
    </div>
  );
}

// ─── Sort Header Component ─────────────────────────────────────────────────────

function SortHeader({ label, col, sortKey, sortDir, onSort }: {
  label: string; col: "companyName" | "industry" | "updatedAt"; sortKey: string; sortDir: "asc" | "desc"; onSort: (col: any) => void;
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

// ─── Account Hub (5-Tab) ───────────────────────────────────────────────────────

type HubTab = "profile" | "meetings" | "brd" | "flows" | "projects" | "mockups";

const HUB_TABS: { id: HubTab; label: string; icon: React.ElementType }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "meetings", label: "Meetings", icon: CalendarCheck },
  { id: "brd", label: "BRD", icon: FileText },
  { id: "flows", label: "Process Flow", icon: GitBranch },
  { id: "projects", label: "Projects & Tasks", icon: FolderOpen },
  { id: "mockups", label: "Mockups", icon: Paintbrush },
];

const MEETING_STATUS_STYLES: Record<string, string> = {
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  "in-progress": "bg-green-50 text-green-700 border-green-200",
  completed: "bg-surface-muted text-text-secondary border-border-default",
  cancelled: "bg-red-50 text-red-600 border-red-200",
};

const PROJECT_STATUS_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  "on-hold": "bg-yellow-50 text-yellow-700 border-yellow-200",
  completed: "bg-surface-muted text-text-secondary border-border-default",
};

export function AccountHub({ profile, onEdit, onBack }: {
  profile: any;
  onEdit: () => void;
  onBack: () => void;
}) {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("activeTab") as HubTab) || "profile";
  const modules: string[] = (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })();
  const [activeTab, setActiveTab] = useState<HubTab>(initialTab);

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* ── Tabs Bar (40px) ────────────────────────────────────────────────── */}
      <div className="h-[40px] flex-shrink-0 flex items-center justify-between border-b border-border-default px-4 bg-white">
        <div className="flex items-end h-full gap-5">
          <button onClick={onBack} className="h-full flex items-center pr-2 text-text-muted hover:text-primary transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          {HUB_TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-1 h-full text-[12px] transition-colors relative ${
                  active
                    ? "text-primary font-medium"
                    : "text-text-secondary hover:text-text-primary font-regular"
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${active ? "text-primary" : "text-text-muted"}`} strokeWidth={2.5} />
                {tab.label}
                {active && <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-text-muted uppercase tracking-widest bg-surface-muted px-2 py-0.5 rounded">
            {profile.engagementStatus}
          </span>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 h-7 px-3 bg-white border border-border-default rounded-md text-[12px] font-medium hover:bg-surface-subtle transition-all active:scale-95"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit Account
          </button>
        </div>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-white styled-scroll">
        <div className="min-w-0">
          {activeTab === "profile" && <ProfileTab profile={profile} modules={modules} />}
          {activeTab === "meetings" && <MeetingsTab accountId={profile.id} companyName={profile.companyName} />}
          {activeTab === "brd" && <BRDTab accountId={profile.id} companyName={profile.companyName} />}
          {activeTab === "flows" && <FlowsTab accountId={profile.id} companyName={profile.companyName} />}
          {activeTab === "projects" && <ProjectsTab accountId={profile.id} companyName={profile.companyName} profile={profile} />}
          {activeTab === "mockups" && <MockupsTab accountId={profile.id} companyName={profile.companyName} />}
        </div>
      </div>
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

export function ProfileTab({ profile, modules }: {
  profile: any;
  modules: string[];
}) {

  return (
    <div className="max-w-3xl mx-auto p-5 space-y-5">
      {/* Account details */}
      <div className="border border-border-default rounded-md p-4">
        <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">Account Details</p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
          {profile.primaryContact && (
            <div className="flex gap-2"><span className="text-text-muted w-16 flex-shrink-0">Contact</span><span className="text-text-primary font-medium">{profile.primaryContact}</span></div>
          )}
          {profile.primaryContactEmail && (
            <div className="flex gap-2"><span className="text-text-muted w-16 flex-shrink-0">Email</span><span className="text-text-primary font-medium">{profile.primaryContactEmail}</span></div>
          )}
          {modules.length > 0 && (
            <div className="col-span-2 flex items-center gap-1.5 flex-wrap mt-1">
              <span className="text-text-muted">Modules:</span>
              {modules.map(m => (
                <span key={m} className="px-1.5 py-0.5 bg-surface-muted text-text-secondary rounded text-[11px]">{m}</span>
              ))}
            </div>
          )}
          {profile.specialConsiderations && (
            <div className="col-span-2 mt-1">
              <span className="text-text-muted block mb-1">Notes</span>
              <p className="text-text-primary text-[12px] leading-relaxed bg-surface-subtle px-3 py-2 rounded-md">{profile.specialConsiderations}</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

// ─── Meetings Tab ─────────────────────────────────────────────────────────────

export function MeetingsTab({ accountId, companyName }: { accountId: string; companyName: string }) {
  const [meetings, setMeetings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, any>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/accounts/${accountId}/meetings`)
      .then(r => r.ok ? r.json() : [])
      .then(setMeetings)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  const toggleExpand = async (meetingId: string) => {
    if (expandedId === meetingId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(meetingId);
    if (!details[meetingId]) {
      setLoadingDetail(meetingId);
      try {
        const res = await fetch(`/api/meetings/${meetingId}`);
        if (res.ok) {
          const data = await res.json();
          setDetails(prev => ({ ...prev, [meetingId]: data }));
        }
      } catch {}
      setLoadingDetail(null);
    }
  };

  if (loading) return <TabLoading />;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[12px] font-semibold text-text-primary">{meetings.length} meeting{meetings.length !== 1 ? "s" : ""}</p>
        <a href="/meetings" className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <Plus className="w-3 h-3" /> New Meeting
        </a>
      </div>

      {meetings.length === 0 ? (
        <TabEmpty icon={CalendarCheck} message="No meetings linked to this account yet." action={{ label: "Schedule Meeting", href: "/meetings" }} />
      ) : (
        <div className="border border-border-default rounded-md overflow-hidden bg-white">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-subtle border-b border-border-default">
                <th className="px-4 py-2 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">Title</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">Type</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">Date</th>
                <th className="px-4 py-2 text-left text-[11px] font-bold text-text-muted uppercase tracking-widest">Status</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {meetings.map((m: any) => (
                <React.Fragment key={m.id}>
                  <tr className="hover:bg-surface-subtle transition-colors cursor-pointer" onClick={() => toggleExpand(m.id)}>
                    <td className="px-4 py-2.5 font-medium text-text-primary">
                      <div className="flex items-center gap-2">
                        {expandedId === m.id ? <ChevronUp className="w-3 h-3 text-text-muted" /> : <ChevronDown className="w-3 h-3 text-text-muted" />}
                        {m.title}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary capitalize">{m.meetingType.replace(/-/g, " ")}</td>
                    <td className="px-4 py-2.5 text-text-secondary">
                      {new Date(m.scheduledAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${MEETING_STATUS_STYLES[m.status] || "bg-surface-muted text-text-muted border-border-default"}`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a href={`/meetings/${m.id}`} onClick={e => e.stopPropagation()} className="p-1 rounded hover:bg-surface-muted text-text-muted inline-block">
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </td>
                  </tr>
                  {expandedId === m.id && (
                    <tr className="bg-surface-muted/30">
                      <td colSpan={5} className="px-8 py-4">
                        {loadingDetail === m.id ? (
                          <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Loading output...
                          </div>
                        ) : details[m.id]?.transcript?.minutesOfMeeting ? (
                          <div className="bg-white border border-border-default rounded-md p-4 shadow-sm">
                            <div className="flex items-center justify-between mb-3 border-b border-border-default pb-2">
                              <span className="text-[10px] font-bold uppercase text-text-muted tracking-widest">Minutes of Meeting</span>
                              <a href={`/meetings/${m.id}/review`} className="text-[10px] text-primary hover:underline">Full Review</a>
                            </div>
                            <MarkdownContent content={details[m.id].transcript.minutesOfMeeting} />
                          </div>
                        ) : (
                          <div className="text-[11px] text-text-muted italic">No minutes generated for this meeting.</div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── BRD Tab ──────────────────────────────────────────────────────────────────

export function BRDTab({ accountId, companyName }: { accountId: string; companyName: string }) {
  const [data, setData] = useState<{ standalone: any[]; fromMeetings: any[] }>({ standalone: [], fromMeetings: [] });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/accounts/${accountId}/brds`)
      .then(r => r.ok ? r.json() : { standalone: [], fromMeetings: [] })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  if (loading) return <TabLoading />;

  const allBrds = [...data.fromMeetings, ...data.standalone];
  const total = allBrds.length;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-text-primary">{total} BRD{total !== 1 ? "s" : ""}</p>
        <a href={`/brd?accountId=${accountId || ""}`} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <Plus className="w-3 h-3" /> New BRD
        </a>
      </div>

      {total === 0 ? (
        <TabEmpty icon={FileText} message="No BRDs linked to this account yet." action={{ label: "Open BRD Maker", href: "/brd" }} />
      ) : (
        <div className="space-y-2">
          {allBrds.map((brd: any) => (
            <div key={brd.id} className="border border-border-default rounded-md overflow-hidden bg-white hover:border-primary/30 transition-colors">
              <div 
                className="px-4 py-2.5 flex items-center justify-between gap-4 cursor-pointer hover:bg-surface-subtle"
                onClick={() => setExpandedId(expandedId === brd.id ? null : brd.id)}
              >
                <div className="flex items-center gap-2">
                  {expandedId === brd.id ? <ChevronUp className="w-3.5 h-3.5 text-text-muted" /> : <ChevronDown className="w-3.5 h-3.5 text-text-muted" />}
                  <div>
                    <p className="text-[12px] font-medium text-text-primary">{brd.meetingTitle || brd.title}</p>
                    <p className="text-[10px] text-text-muted">
                      {brd.meetingDate ? new Date(brd.meetingDate).toLocaleDateString() : new Date(brd.updatedAt).toLocaleDateString()}
                      {brd.meetingTitle ? " · Meeting output" : " · Standalone"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a href={brd.meetingTitle ? `/meetings/${brd.id}/review` : `/brd?loadId=${brd.id}`} onClick={e => e.stopPropagation()} className="text-text-muted hover:text-primary">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
              {expandedId === brd.id && (
                <div className="px-4 py-4 bg-surface-muted/20 border-t border-border-default">
                  <div className="bg-white p-4 rounded border border-border-default shadow-sm max-h-[400px] overflow-y-auto">
                    <MarkdownContent content={brd.data || "No content found."} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Process Flow Tab ─────────────────────────────────────────────────────────

export function FlowsTab({ accountId, companyName }: { accountId: string; companyName: string }) {
  const [data, setData] = useState<{ asIs: any[]; toBe: any[]; uncategorized: any[] }>({ asIs: [], toBe: [], uncategorized: [] });
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState<"as-is" | "to-be">("as-is");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/accounts/${accountId}/flows`)
      .then(r => r.ok ? r.json() : { asIs: [], toBe: [], uncategorized: [] })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const updateTitle = async (flowId: string) => {
    if (!newTitle.trim()) return;
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/works`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: flowId, title: newTitle }),
      });
      if (res.ok) {
        setEditingTitleId(null);
        load();
      }
    } catch {}
    setSavingTitle(false);
  };

  const downloadPNG = (id: string, title: string) => {
    const el = document.getElementById(`flow-wrap-${id}`);
    if (!el) return;
    htmlToImage.toPng(el, { backgroundColor: "#ffffff" })
      .then((dataUrl) => {
        const a = document.createElement("a");
        a.setAttribute("download", `${title.replace(/\s+/g, "_")}.png`);
        a.setAttribute("href", dataUrl);
        a.click();
      });
  };

  if (loading) return <TabLoading />;

  const flows = subTab === "as-is" ? [...data.asIs, ...data.uncategorized] : data.toBe;
  const total = data.asIs.length + data.toBe.length + data.uncategorized.length;

  return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1 border border-border-default rounded-md overflow-hidden text-[12px] bg-white">
          {(["as-is", "to-be"] as const).map(tab => (
            <button key={tab} onClick={() => setSubTab(tab)}
              className={`px-3 py-1 transition-colors ${subTab === tab ? "bg-primary text-white font-medium" : "text-text-secondary hover:bg-surface-subtle"}`}
            >
              {tab === "as-is" ? "AS-IS" : "TO-BE"}
            </button>
          ))}
        </div>
        <a href={`/architect?accountId=${accountId || ""}&flowCategory=${subTab}`} className="flex items-center gap-1 text-[12px] text-primary hover:underline group">
          <Plus className="w-3 h-3 group-hover:scale-110 transition-transform" /> New {subTab === "as-is" ? "AS-IS" : "TO-BE"} Flow
        </a>
      </div>

      {total === 0 ? (
        <TabEmpty icon={GitBranch} message="No process flows linked to this account yet." action={{ label: "Open Architect Flow", href: "/architect" }} />
      ) : flows.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-text-muted">No {subTab.toUpperCase()} flows yet.</div>
      ) : (
        <div className="space-y-3">
          {flows.map((flow: any) => {
             let flowData: any = {};
             try { flowData = JSON.parse(flow.data); } catch {}
             const isMermaid = flowData.diagramType?.startsWith("mermaid") || !!flowData.chart;

             return (
            <div key={flow.id} className="border border-border-default rounded-xl overflow-hidden bg-white hover:border-primary/30 transition-all shadow-sm">
              <div 
                className="px-4 py-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-surface-subtle group"
                onClick={() => setExpandedId(expandedId === flow.id ? null : flow.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="p-1.5 rounded bg-surface-muted text-text-muted group-hover:text-primary transition-colors">
                    {expandedId === flow.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                  <div>
                    {editingTitleId === flow.id ? (
                      <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                        <input 
                          autoFocus
                          className="text-[12px] font-medium border border-primary px-2 py-0.5 rounded outline-none w-64"
                          value={newTitle}
                          onChange={e => setNewTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") updateTitle(flow.id); if (e.key === "Escape") setEditingTitleId(null); }}
                        />
                        <button onClick={() => updateTitle(flow.id)} disabled={savingTitle} className="text-primary hover:text-primary-hover">
                          {savingTitle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold text-text-primary">{flow.title}</p>
                        <button onClick={(e) => { e.stopPropagation(); setEditingTitleId(flow.id); setNewTitle(flow.title); }} className="p-1 hover:bg-surface-muted rounded text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <p className="text-[10px] text-text-muted mt-0.5">{new Date(flow.updatedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 pr-2">
                   <a href={`/architect?loadId=${flow.id}`} onClick={e => e.stopPropagation()} className="p-2 rounded hover:bg-surface-muted text-text-muted hover:text-primary transition-all">
                     <ExternalLink className="w-3.5 h-3.5" />
                   </a>
                </div>
              </div>
              {expandedId === flow.id && (
                <div className="p-4 bg-surface-muted/30 border-t border-border-default">
                  <div id={`flow-wrap-${flow.id}`} className="bg-white rounded-xl border border-border-default shadow-lg overflow-hidden h-[500px] relative group/viewer">
                    {isMermaid ? (
                      <div className="w-full h-full p-8 flex items-center justify-center overflow-auto relative">
                        <div id={`flow-wrap-${flow.id}`} className="bg-white p-4">
                           <MermaidChart chart={flowData.chart || flowData.data} />
                        </div>
                        <div className="absolute top-4 right-4 z-10">
                          <button 
                            onClick={(e) => { e.stopPropagation(); downloadPNG(flow.id, flow.title); }}
                            className="bg-white/90 backdrop-blur-sm border border-border-default px-3 py-1.5 rounded-lg shadow-sm text-[11px] font-bold uppercase tracking-wider text-text-muted hover:text-primary flex items-center gap-1.5 transition-all"
                          >
                             <Download className="w-3.5 h-3.5" /> Export PNG
                          </button>
                        </div>
                      </div>
                    ) : (
                      <WorkflowCanvas initialNodes={flowData.nodes} initialEdges={flowData.edges} />
                    )}
                    <div className="absolute bottom-4 left-4 z-10 opacity-0 group-hover/viewer:opacity-100 transition-opacity">
                      <p className="text-[10px] bg-white/80 backdrop-blur-sm border border-border-default px-2 py-1 rounded text-text-muted font-medium">
                        Read-only preview. Use <span className="text-primary font-bold mx-0.5">Edit in Architect</span> for full controls.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
             );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Projects & Tasks Tab ─────────────────────────────────────────────────────

export function ProjectsTab({ accountId, companyName, profile }: { accountId: string; companyName: string; profile?: any }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"projects" | "tasks">("tasks");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectSubTab, setProjectSubTab] = useState<"list" | "gantt">("list");
  
  // SETTINGS/SHARING STATE
  const [sharingProject, setSharingProject] = useState<any>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const { showToast } = useToast();

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/accounts/${accountId}/projects`).then(r => r.ok ? r.json() : []),
      fetch(`/api/accounts/${accountId}/tasks`).then(r => r.ok ? r.json() : [])
    ]).then(([projData, taskData]) => {
      setProjects(projData);
      setTasks(taskData);
    }).finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenSettings = (project: any) => {
    setSharingProject(project);
    setIsSettingsModalOpen(true);
  };

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);
  const projectTasks = useMemo(() => tasks.filter(t => t.projectId === selectedProjectId), [tasks, selectedProjectId]);

  if (loading) return <TabLoading />;

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex bg-surface-muted p-1 rounded-lg">
          <button 
            onClick={() => { setViewMode("tasks"); setSelectedProjectId(null); }} 
            className={`px-4 py-1 text-[11px] font-semibold rounded-md transition-all ${viewMode === "tasks" && !selectedProjectId ? "bg-white text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            All Action Items
          </button>
          <button 
            onClick={() => { setViewMode("projects"); setSelectedProjectId(null); }} 
            className={`px-4 py-1 text-[11px] font-semibold rounded-md transition-all ${viewMode === "projects" && !selectedProjectId ? "bg-white text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`}
          >
            Projects
          </button>
          {selectedProjectId && (
            <div className="flex items-center gap-2 ml-2 pl-2 border-l border-border-default">
              <span className="text-[11px] font-bold text-primary bg-white px-2 py-1 rounded shadow-sm flex items-center gap-1.5 uppercase tracking-tighter">
                <FolderOpen className="w-3 h-3" /> {selectedProject?.name}
              </span>
              <button 
                onClick={() => setSelectedProjectId(null)}
                className="p-1 hover:bg-white rounded-md text-text-muted hover:text-red-500 transition-colors"
              >
                <Plus className="w-3 h-3 rotate-45" />
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <a href={`/tasks?clientId=${accountId}`} className="flex items-center gap-1 text-[11px] text-primary hover:underline font-medium">
             <ExternalLink className="w-3 h-3" /> External Launcher
          </a>
        </div>
      </div>

      {selectedProjectId ? (
        <div className="space-y-4">
           {/* SUB-TABS (Tabs vs Gantt) */}
           <div className="flex items-center justify-between border-b border-border-default pb-0">
              <div className="flex gap-6 h-10 items-end">
                <button 
                  onClick={() => setProjectSubTab("list")}
                  className={`h-full flex items-center px-1 text-[12px] border-b-2 transition-all relative ${projectSubTab === "list" ? "border-primary text-primary font-bold" : "border-transparent text-text-muted font-medium"}`}
                >
                  Action Item List
                </button>
                <button 
                  onClick={() => setProjectSubTab("gantt")}
                  className={`h-full flex items-center px-1 text-[12px] border-b-2 transition-all relative ${projectSubTab === "gantt" ? "border-primary text-primary font-bold" : "border-transparent text-text-muted font-medium"}`}
                >
                  Visual Roadmap (Gantt)
                </button>
              </div>
              <div className="flex gap-2 pb-2">
                 <button 
                    onClick={() => handleOpenSettings(selectedProject)}
                    className="p-1.5 hover:bg-slate-100 rounded-md text-text-muted hover:text-primary transition-all flex items-center gap-1.5"
                    title="Project Settings"
                 >
                    <Settings className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Settings</span>
                 </button>
                 <button 
                   onClick={() => handleOpenSettings({...selectedProject, forceTab: 'share'})}
                   className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-[11px] font-bold shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all uppercase tracking-tight"
                 >
                   <Share className="w-3 h-3" strokeWidth={3} /> Share Link
                 </button>
              </div>
           </div>

           {projectSubTab === "list" ? (
             <TaskTable tasks={projectTasks} />
           ) : (
             <div className="h-[500px] border border-border-default rounded-2xl overflow-hidden bg-white shadow-xl">
                <InteractiveGantt 
                  events={projectTasks.map(t => ({
                    id: t.id,
                    taskCode: t.taskCode || "T-00",
                    subject: t.title || t.subject,
                    startDate: t.startDate || t.plannedStart,
                    endDate: t.endDate || t.plannedEnd,
                    durationHours: t.durationHours || 1,
                    owner: t.owner || "Team",
                    description: t.description || "",
                    status: t.status,
                    paddingDays: t.paddingDays || 0,
                    externalPlannedEnd: t.externalPlannedEnd
                  }))}
                  onUpdateEvents={() => {}} 
                  scale="day" 
                />
             </div>
           )}
        </div>
      ) : viewMode === "projects" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-text-primary">{projects.length} Project{projects.length !== 1 ? "s" : ""}</p>
            <button className="flex items-center gap-1 text-[11px] text-primary hover:underline border-none bg-transparent cursor-pointer font-medium uppercase tracking-tighter">
              <Plus className="w-3 h-3" strokeWidth={3} /> New Project
            </button>
          </div>
          {projects.length === 0 ? (
            <div className="border border-dashed border-border-default rounded-xl p-8 text-center bg-surface-muted/10">
               <FolderOpen className="w-8 h-8 mx-auto text-text-muted opacity-20 mb-2" />
               <p className="text-[11px] text-text-secondary italic">No projects linked to this account.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {projects.map((p: any) => (
                <div key={p.id} className="p-4 rounded-xl border border-border-default bg-white hover:border-primary/20 hover:shadow-lg transition-all flex items-start justify-between group">
                  <div className="space-y-1.5 flex-1 min-w-0" onClick={() => setSelectedProjectId(p.id)}>
                    <p className="text-[13px] font-bold text-text-primary group-hover:text-primary transition-colors cursor-pointer">{p.name}</p>
                    <div className="flex items-center gap-2">
                       <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${PROJECT_STATUS_STYLES[p.status] || "bg-surface-muted text-text-muted border-border-default"}`}>
                        {p.status}
                      </span>
                      <span className="text-[10px] text-text-muted font-bold font-mono">
                        {p.taskSummary?.completed ?? 0}/{p.taskCount ?? 0} ITEMS
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4 transition-all group-hover:translate-x-0 translate-x-2">
                    <button 
                      onClick={(ev) => { ev.stopPropagation(); handleOpenSettings(p); }}
                      className="p-2 hover:bg-slate-100 rounded-lg text-text-muted hover:text-slate-900 transition-all opacity-0 group-hover:opacity-100" 
                      title="Project Settings"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    <button onClick={() => setSelectedProjectId(p.id)} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-text-muted" title="View Project Details">
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-text-primary">{tasks.length} Action Item{tasks.length !== 1 ? "s" : ""}</p>
          </div>
          <TaskTable tasks={tasks} />
        </div>
      )}

      {/* PROJECT SETTINGS & SHARE MODAL */}
      <ProjectSettingsModal 
        isOpen={isSettingsModalOpen} 
        onClose={() => setIsSettingsModalOpen(false)} 
        project={sharingProject} 
        profile={profile}
        onUpdate={loadData}
      />
    </div>
  );
}

function TaskTable({ tasks }: { tasks: any[] }) {
  if (tasks.length === 0) {
    return (
      <div className="border border-dashed border-border-default rounded-xl p-8 text-center bg-surface-muted/10">
        <CheckCircle2 className="w-8 h-8 mx-auto text-text-muted opacity-20 mb-2" />
        <p className="text-[11px] text-text-secondary italic font-medium">No results found.</p>
      </div>
    );
  }

  return (
    <div className="border border-border-default rounded-xl overflow-hidden bg-white shadow-sm">
      <table className="w-full text-[11px]">
        <thead className="bg-[#FAFAFA] border-b border-border-default">
          <tr>
            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-widest text-text-muted text-[9px]">Status</th>
            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-widest text-text-muted text-[9px]">Task Item</th>
            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-widest text-text-muted text-[9px]">Linked To</th>
            <th className="px-4 py-2.5 text-left font-bold uppercase tracking-widest text-text-muted text-[9px]">Owner</th>
            <th className="px-4 py-2.5 text-right font-bold uppercase tracking-widest text-text-muted text-[9px]">Deadline</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {tasks.map((task: any) => (
            <tr key={task.id} className="hover:bg-surface-subtle transition-colors">
              <td className="px-4 py-3">
                 <span className={`text-[9px] font-black uppercase tracking-tighter px-1.5 py-0.5 rounded border ${task.status === "completed" ? "bg-green-50 text-green-700 border-green-200" : task.status === "in-progress" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-surface-muted text-text-muted border-border-default"}`}>
                   {task.status}
                 </span>
              </td>
              <td className="px-4 py-3 font-bold text-text-primary">{task.title || task.subject}</td>
              <td className="px-4 py-3 text-text-muted">
                {task.project ? (
                  <span className="flex items-center gap-1 text-[10px] text-primary/70 font-bold uppercase truncate max-w-[150px]">
                    <FolderOpen className="w-2.5 h-2.5" />
                    {task.project.name}
                  </span>
                ) : (
                  <span className="text-[9px] text-slate-300 font-bold uppercase italic tracking-tighter">Account Level</span>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                   <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[8px] font-black">
                      {task.owner?.charAt(0) || "T"}
                   </div>
                   <span className="text-text-secondary font-medium lowercase italic opacity-60">{task.owner || "Team"}</span>
                </div>
              </td>
              <td className="px-4 py-3 text-right text-text-muted font-bold font-mono">
                {task.due || task.plannedEnd ? new Date(task.due || task.plannedEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmailShareModal({ isOpen, onClose, project, profile }: { isOpen: boolean; onClose: () => void; project: any; profile?: any }) {
  const [email, setEmail] = useState("");
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const shareLink = project?.shareToken ? `${window.location.origin}/share/${project.shareToken}` : null;

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setIsCopied(true);
    showToast("Link copied to clipboard!", "success");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSend = () => {
     if (!email.includes("@")) {
         showToast("Please enter a valid email", "error");
         return;
     }
     showToast(`Sharing link sent to ${email}`, "success");
     onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 flex flex-col">
        <div className="p-8 pb-4">
           <div className="flex items-center justify-between mb-2">
              <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center">
                 <Share className="w-5 h-5 text-primary" strokeWidth={2.5} />
              </div>
              <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400">
                 <X className="w-5 h-5" />
              </button>
           </div>
           <h3 className="text-xl font-bold text-slate-800">Share Client Roadmap</h3>
           <p className="text-[13px] text-slate-500 mt-1 leading-relaxed">
             Share {project?.name} with your client. They will only see padded deadlines.
           </p>
        </div>

        <div className="p-8 pt-4 space-y-6">
           {/* Direct Link Section */}
           <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Secure Share Link</label>
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl p-2 pl-4">
                 <span className="text-[12px] font-medium text-slate-500 truncate italic flex-1">{shareLink || "Not generated"}</span>
                 <button 
                  onClick={handleCopy}
                  className={`h-10 px-4 rounded-xl flex items-center gap-2 transition-all ${isCopied ? 'bg-green-500 text-white shadow-lg shadow-green-500/20' : 'bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20'}`}
                 >
                   {isCopied ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <Copy className="w-3.5 h-3.5" strokeWidth={2.5} />}
                   <span className="text-[11px] font-black uppercase tracking-tight">{isCopied ? 'Copied' : 'Copy'}</span>
                 </button>
              </div>
           </div>

           <div className="relative h-px bg-slate-100 flex items-center justify-center">
              <span className="bg-white px-4 text-[10px] font-black text-slate-300 uppercase tracking-widest">or send via email</span>
           </div>

           {/* Email Section */}
           <div className="space-y-3">
              <div className="space-y-1.5 text-left">
                <label className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">Send to Email</label>
                <div className="relative">
                   <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
                   <input 
                    type="email"
                    placeholder="Enter email or select below..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-12 pl-11 pr-4 bg-white border border-slate-200 rounded-2xl text-[13px] font-medium focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                   />
                </div>
              </div>

              {profile?.primaryContactEmail && (
                <div className="flex items-center gap-3">
                   <button 
                    onClick={() => setEmail(profile.primaryContactEmail)}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-all flex-1 text-left ${email === profile.primaryContactEmail ? 'border-primary bg-primary/5' : 'border-slate-100 bg-slate-50'}`}
                   >
                     <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[10px]">
                        {profile.primaryContact?.charAt(0) || "P"}
                     </div>
                     <div className="min-w-0">
                        <p className="text-[11px] font-bold text-slate-700 truncate tracking-tight uppercase">Primary: {profile.primaryContact}</p>
                        <p className="text-[10px] text-slate-400 truncate italic">{profile.primaryContactEmail}</p>
                     </div>
                   </button>
                </div>
              )}
           </div>

           <button 
            onClick={handleSend}
            className="w-full h-12 bg-primary text-white rounded-2xl text-[13px] font-black uppercase tracking-widest shadow-xl shadow-primary/20 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
           >
             <Mail className="w-4 h-4" /> Send Secure Link
           </button>
        </div>
      </div>
    </div>
  );
}

// ─── Mockups Tab ──────────────────────────────────────────────────────────────

const MOCKUP_STATUS_STYLES: Record<string, string> = {
  open: "bg-blue-50 text-blue-700 border-blue-200",
  for_approval: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-600 border-red-200",
};

const MOCKUP_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  for_approval: "For Approval",
  approved: "Approved",
  rejected: "Rejected",
};

export function MockupsTab({ accountId, companyName }: { accountId: string; companyName: string }) {
  const [mockups, setMockups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetch(`/api/accounts/${accountId}/mockups`)
      .then(r => r.ok ? r.json() : [])
      .then(setMockups)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [accountId]);

  const updateStatus = async (mockupId: string, status: string) => {
    setUpdatingId(mockupId);
    await fetch(`/api/accounts/${accountId}/mockups`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mockupId, status }),
    });
    setUpdatingId(null);
    load();
  };

  const previewMockup = (html: string, title: string) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const downloadMockup = (html: string, title: string) => {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <TabLoading />;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-semibold text-text-primary">{mockups.length} Mockup{mockups.length !== 1 ? "s" : ""}</p>
        <a href={`/mockup?accountId=${accountId}`} className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          <Plus className="w-3 h-3" /> New Mockup
        </a>
      </div>

      {mockups.length === 0 ? (
        <TabEmpty icon={Paintbrush} message="No mockups linked to this account yet." action={{ label: "Open Mockup Maker", href: "/mockup" }} />
      ) : (
        <div className="border border-border-default rounded-md overflow-hidden">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-table-header border-b border-border-default">
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-text-muted">Name</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-text-muted">Created By</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-text-muted">Date</th>
                <th className="text-left px-4 py-2 text-[11px] font-semibold text-text-muted">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default">
              {mockups.map((m: any) => (
                <tr key={m.id} className="hover:bg-surface-subtle transition-colors">
                  <td className="px-4 py-2.5 font-medium text-text-primary">{m.title}</td>
                  <td className="px-4 py-2.5 text-text-muted">{m.createdByName || "—"}</td>
                  <td className="px-4 py-2.5 text-text-muted whitespace-nowrap">
                    {m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value={m.status || "open"}
                      disabled={updatingId === m.id}
                      onChange={(e) => updateStatus(m.id, e.target.value)}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded border cursor-pointer focus:outline-none ${MOCKUP_STATUS_STYLES[m.status] || MOCKUP_STATUS_STYLES.open}`}
                    >
                      {Object.entries(MOCKUP_STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => previewMockup(m.data, m.title)}
                        title="Preview in new tab"
                        className="text-text-muted hover:text-primary transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => downloadMockup(m.data, m.title)}
                        title="Download HTML file"
                        className="text-text-muted hover:text-primary transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Shared Tab Helpers ───────────────────────────────────────────────────────

function TabLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-4 h-4 text-primary animate-spin" />
    </div>
  );
}

function TabEmpty({ icon: Icon, message, action }: { icon: React.ElementType; message: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      <Icon className="w-6 h-6 text-text-muted opacity-40" />
      <p className="text-[12px] text-text-muted">{message}</p>
      {action && (
        <a href={action.href} className="text-[12px] text-primary hover:underline">{action.label}</a>
      )}
    </div>
  );
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, idx) => {
        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="text-[11px] font-semibold text-text-primary mt-3 mb-1">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={idx} className="text-xs font-bold text-text-primary mt-4 mb-1">
              {line.slice(2)}
            </h2>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          const isCheck = line.includes("[x]") || line.includes("[ ]");
          return (
            <p key={idx} className="text-[11px] text-text-secondary leading-relaxed pl-3">
              • {line.slice(2)}
            </p>
          );
        }
        if (line.trim() === "") {
          return <div key={idx} className="h-1" />;
        }
        return (
          <p key={idx} className="text-[11px] text-text-secondary leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
}
