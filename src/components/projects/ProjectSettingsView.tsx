"use client";

import React, { useState, useEffect } from "react";
import {
  Users, Copy, Check, Shield, Trash2, Loader2,
  Archive, RotateCcw, Plus, Mail, Globe, Lock,
  Send, ExternalLink, Link as LinkIcon
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface ProjectSettingsViewProps {
  project: {
    id: string;
    name?: string | null;
    shareToken?: string | null;
    assignedIds?: string | null;
    archived?: boolean;
  };
  onUpdate: () => void;
}

interface Stakeholder {
  id: string;
  fullName: string;
  email: string;
  role?: string;
  hasPortalAccess: boolean;
}

export default function ProjectSettingsView({ project, onUpdate }: ProjectSettingsViewProps) {
  const [loading, setLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStakeholder, setNewStakeholder] = useState({ fullName: "", email: "", role: "" });
  const [invitingId, setInvitingId] = useState<string | null>(null);

  useEffect(() => {
    if (project?.id) {
      const ids = project.assignedIds
        ? (typeof project.assignedIds === "string"
            ? project.assignedIds.split(",").filter(Boolean)
            : project.assignedIds)
        : [];
      setAssignedIds(ids);
      loadUsers();
      loadStakeholders();
    }
  }, [project?.id, project?.assignedIds]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(Array.isArray(data) ? data : []);
      }
    } catch {}
  };

  const loadStakeholders = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/stakeholders`);
      if (res.ok) setStakeholders(await res.json());
    } catch {}
  };

  const shareLink =
    typeof window !== "undefined" && project?.shareToken
      ? `${window.location.origin}/share/${project.shareToken}`
      : null;

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setIsCopied(true);
    showToast("Portal link copied!", "success");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const toggleUser = async (userId: string) => {
    const newIds = assignedIds.includes(userId)
      ? assignedIds.filter((id) => id !== userId)
      : [...assignedIds, userId];
    setAssignedIds(newIds);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedIds: newIds.join(",") }),
      });
      if (res.ok) {
        onUpdate();
        showToast(assignedIds.includes(userId) ? "Removed from team" : "Added to team", "success");
      }
    } catch {
      showToast("Failed to update team", "error");
    }
  };

  const addStakeholder = async () => {
    if (!newStakeholder.fullName) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/stakeholders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newStakeholder),
      });
      if (res.ok) {
        showToast("Stakeholder added", "success");
        setNewStakeholder({ fullName: "", email: "", role: "" });
        setShowAddForm(false);
        loadStakeholders();
      } else {
        showToast("Failed to add stakeholder", "error");
      }
    } catch {
      showToast("Failed to add stakeholder", "error");
    } finally {
      setLoading(false);
    }
  };

  const deleteStakeholder = async (id: string) => {
    if (!confirm("Remove this stakeholder?")) return;
    try {
      const res = await fetch(`/api/projects/${project.id}/stakeholders?stakeholderId=${id}`, { method: "DELETE" });
      if (res.ok) { showToast("Stakeholder removed", "success"); loadStakeholders(); }
    } catch {
      showToast("Failed to remove stakeholder", "error");
    }
  };

  const sendInvite = async (stakeholder: Stakeholder) => {
    if (!stakeholder.email) { showToast("Stakeholder has no email address", "error"); return; }
    setInvitingId(stakeholder.id);
    try {
      const res = await fetch(`/api/projects/${project.id}/stakeholders/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stakeholderId: stakeholder.id }),
      });
      if (res.ok) {
        showToast(`Portal invite sent to ${stakeholder.email}`, "success");
        loadStakeholders(); // refresh hasPortalAccess badge
      } else {
        const text = await res.text();
        showToast(text || "Failed to send invite", "error");
      }
    } catch {
      showToast("Failed to send invite", "error");
    } finally {
      setInvitingId(null);
    }
  };

  const handleToggleArchive = async () => {
    const action = project.archived ? "Restore" : "Archive";
    if (!confirm(`${action} this project?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !project.archived }),
      });
      if (res.ok) { showToast(`Project ${project.archived ? "restored" : "archived"}`, "success"); window.location.reload(); }
    } catch {
      showToast("Operation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!project) return null;

  const assignedMembers = availableUsers.filter((u) => assignedIds.includes(u.id));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-5xl mx-auto pb-24">

      {/* HEADER */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest rounded">
              Project Configuration
            </span>
            <span className="w-1 h-1 bg-slate-200 rounded-full" />
            <span className="text-[10px] font-bold text-slate-400">ID: {project.id}</span>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">{project.name || "Untitled Project"}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Portal preview link */}
          {shareLink && (
            <a
              href={shareLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 h-9 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-all"
            >
              <ExternalLink size={13} />
              Client Portal
            </a>
          )}
          <button
            onClick={handleToggleArchive}
            disabled={loading}
            className={`flex items-center gap-2 px-3 h-9 rounded-lg border transition-all font-black text-[10px] uppercase tracking-widest ${
              project.archived
                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                : "bg-white border-slate-200 text-slate-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600"
            }`}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : project.archived ? <RotateCcw size={13} /> : <Archive size={13} />}
            {project.archived ? "Restore" : "Archive"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* LEFT: INTERNAL TEAM (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 border border-indigo-100">
                <Users size={15} />
              </div>
              <div>
                <h3 className="text-[10px] font-black text-slate-900 tracking-widest uppercase">Internal Team</h3>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Assigned members</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-xs font-black text-indigo-600">
              {assignedMembers.length}
              <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest">Members</span>
            </span>
          </div>

          {availableUsers.length === 0 ? (
            <div className="py-8 flex flex-col items-center bg-slate-50 border border-dashed border-slate-200 rounded-lg">
              <Users className="w-6 h-6 text-slate-300 mb-2" />
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Loading...</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {availableUsers.map((user) => {
                const isAssigned = assignedIds.includes(user.id);
                return (
                  <div
                    key={user.id}
                    onClick={() => toggleUser(user.id)}
                    className={`group flex items-center justify-between p-2.5 rounded-lg border transition-all cursor-pointer ${
                      isAssigned
                        ? "border-indigo-200 bg-indigo-50/40"
                        : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-black text-[11px] shrink-0 transition-colors ${
                        isAssigned ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                      }`}>
                        {user.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="truncate">
                        <p className="text-xs font-bold text-slate-800 truncate leading-tight">{user.name}</p>
                        <p className="text-[9px] text-slate-400 truncate leading-tight">{user.profileRole || user.role || "Member"}</p>
                      </div>
                    </div>
                    <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all shrink-0 ${
                      isAssigned ? "bg-indigo-600 border-indigo-600 text-white" : "border-slate-200 opacity-0 group-hover:opacity-100"
                    }`}>
                      <Check size={9} strokeWidth={4} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: EXTERNAL STAKEHOLDERS + PORTAL (3 cols) */}
        <div className="lg:col-span-3 flex flex-col gap-5">

          {/* STAKEHOLDERS */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex-1">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 border border-emerald-100">
                  <Shield size={15} />
                </div>
                <div>
                  <h3 className="text-[10px] font-black text-slate-900 tracking-widest uppercase">External Stakeholders</h3>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Client contacts with portal access</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1.5 px-3 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
              >
                <Plus size={11} strokeWidth={3} />
                {showAddForm ? "Cancel" : "Add"}
              </button>
            </div>

            {showAddForm && (
              <div className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-lg animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-3 gap-2.5 mb-3">
                  {[
                    { label: "Full Name", key: "fullName", placeholder: "e.g. John Doe", type: "text" },
                    { label: "Email Address", key: "email", placeholder: "john@company.com", type: "email" },
                    { label: "Designation", key: "role", placeholder: "e.g. Project Lead", type: "text" },
                  ].map(({ label, key, placeholder, type }) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
                      <input
                        type={type}
                        value={(newStakeholder as any)[key]}
                        onChange={(e) => setNewStakeholder({ ...newStakeholder, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full px-2.5 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={addStakeholder}
                  disabled={loading || !newStakeholder.fullName}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} strokeWidth={3} />}
                  Finalize Stakeholder
                </button>
              </div>
            )}

            {stakeholders.length === 0 ? (
              <div className="py-10 flex flex-col items-center bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                <Mail className="w-7 h-7 text-slate-300 mb-2" />
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">No stakeholders yet</p>
                <p className="text-[9px] text-slate-400 mt-1">Add a client contact to grant portal access</p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                      <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Role</th>
                      <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                      <th className="px-3 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stakeholders.map((sh) => (
                      <tr key={sh.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors group">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center font-black text-[10px] text-emerald-700 shrink-0">
                              {sh.fullName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 leading-tight">{sh.fullName}</p>
                              <p className="text-[10px] text-slate-400 leading-tight">{sh.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-[11px] text-slate-500">{sh.role || "—"}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                            sh.hasPortalAccess
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                              : "bg-slate-50 border-slate-200 text-slate-400"
                          }`}>
                            <Globe size={7} />
                            {sh.hasPortalAccess ? "Invited" : "No Access"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Send portal invite */}
                            {sh.email && (
                              <button
                                onClick={() => sendInvite(sh)}
                                disabled={invitingId === sh.id}
                                title={sh.hasPortalAccess ? "Resend portal invite" : "Send portal invite"}
                                className="flex items-center gap-1 px-2 h-7 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 rounded-md text-[9px] font-black uppercase tracking-widest transition-all disabled:opacity-50"
                              >
                                {invitingId === sh.id ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                                {sh.hasPortalAccess ? "Resend" : "Invite"}
                              </button>
                            )}
                            {/* Delete */}
                            <button
                              onClick={() => deleteStakeholder(sh.id)}
                              className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={12} />
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

          {/* PORTAL LINK CARD */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                  <LinkIcon size={14} />
                </div>
                <div>
                  <h3 className="text-[10px] font-black text-slate-900 tracking-widest uppercase">Shared Portal Link</h3>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    Only registered stakeholder emails can unlock it
                  </p>
                </div>
              </div>
              {shareLink && (
                <a
                  href={shareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 h-7 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-500 transition-all"
                >
                  <ExternalLink size={10} />
                  Preview
                </a>
              )}
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1.5 pl-3">
              <span className="text-[11px] text-slate-500 truncate flex-1 font-medium leading-none">
                {shareLink || <span className="text-slate-300 italic">Token not available</span>}
              </span>
              <button
                onClick={handleCopy}
                disabled={!shareLink}
                className={`h-7 w-7 rounded-md flex items-center justify-center transition-all shrink-0 ${
                  isCopied ? "bg-emerald-500 text-white" : "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-30"
                }`}
              >
                {isCopied ? <Check size={11} strokeWidth={3} /> : <Copy size={11} />}
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-2.5 leading-relaxed">
              Share this link with clients — they enter their registered email to view buffered delivery dates. Internal tasks and budgets remain private.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
