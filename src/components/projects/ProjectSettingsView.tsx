"use client";

import React, { useState, useEffect } from "react";
import {
  Users, Share, Copy, Check,
  Shield, Trash2, Loader2,
  Archive, RotateCcw, ExternalLink, Plus, Mail,
  Globe, Lock
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

export default function ProjectSettingsView({
  project,
  onUpdate,
}: ProjectSettingsViewProps) {
  const [loading, setLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStakeholder, setNewStakeholder] = useState({ fullName: "", email: "", role: "" });

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
    } catch (err) {}
  };

  const loadStakeholders = async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/stakeholders`);
      if (res.ok) {
        const data = await res.json();
        setStakeholders(data);
      }
    } catch (err) {}
  };

  const shareLink =
    typeof window !== "undefined" && project?.shareToken
      ? `${window.location.origin}/share/${project.shareToken}`
      : null;

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setIsCopied(true);
    showToast("Link copied!", "success");
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
        showToast(
          assignedIds.includes(userId) ? "Removed from team" : "Added to team",
          "success"
        );
      }
    } catch (err) {
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
      }
    } catch (err) {
      showToast("Failed to add stakeholder", "error");
    } finally {
      setLoading(false);
    }
  };

  const deleteStakeholder = async (id: string) => {
    if (!confirm("Remove this stakeholder?")) return;
    try {
      const res = await fetch(
        `/api/projects/${project.id}/stakeholders?stakeholderId=${id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        showToast("Stakeholder removed", "success");
        loadStakeholders();
      }
    } catch (err) {
      showToast("Failed to remove stakeholder", "error");
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
      if (res.ok) {
        showToast(
          `Project ${project.archived ? "restored" : "archived"}`,
          "success"
        );
        window.location.reload();
      }
    } catch (err) {
      showToast("Operation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!project) return null;

  const assignedMembers = availableUsers.filter((u) =>
    assignedIds.includes(u.id)
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-6xl mx-auto pb-24">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest rounded">
              Project Configuration
            </span>
            <span className="w-1 h-1 bg-slate-200 rounded-full" />
            <span className="text-[10px] font-bold text-slate-400">ID: {project.id}</span>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">
            {project.name || "Untitled Project"}
          </h2>
        </div>

        <button
          onClick={handleToggleArchive}
          disabled={loading}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all font-black text-[10px] uppercase tracking-widest ${
            project.archived
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              : "bg-white border-slate-200 text-slate-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600"
          }`}
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : project.archived ? (
            <RotateCcw size={14} />
          ) : (
            <Archive size={14} />
          )}
          {project.archived ? "Restore Roadmap" : "Archive Roadmap"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">

          {/* INTERNAL TEAM */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 border border-indigo-100">
                  <Users size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 tracking-widest uppercase">
                    Internal Team
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    Personnel assigned to this roadmap
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-full text-xs font-black text-indigo-600">
                {assignedMembers.length}
                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">
                  Members
                </span>
              </span>
            </div>

            {availableUsers.length === 0 ? (
              <div className="py-8 flex flex-col items-center bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                <Users className="w-7 h-7 text-slate-300 mb-2" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Loading team members...
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableUsers.map((user) => {
                  const isAssigned = assignedIds.includes(user.id);
                  return (
                    <div
                      key={user.id}
                      onClick={() => toggleUser(user.id)}
                      className={`group flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer ${
                        isAssigned
                          ? "border-indigo-200 bg-indigo-50/30"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-xs shrink-0 transition-colors ${
                            isAssigned
                              ? "bg-indigo-600 text-white"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {user.name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-800 truncate leading-tight">
                            {user.name}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate leading-tight">
                            {user.profileRole || user.role || "Member"}
                          </p>
                        </div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded flex items-center justify-center border transition-all shrink-0 ${
                          isAssigned
                            ? "bg-indigo-600 border-indigo-600 text-white"
                            : "border-slate-200 opacity-0 group-hover:opacity-100"
                        }`}
                      >
                        {isAssigned ? (
                          <Check size={10} strokeWidth={4} />
                        ) : (
                          <Plus size={10} strokeWidth={4} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* EXTERNAL STAKEHOLDERS */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600 border border-emerald-100">
                  <Shield size={16} />
                </div>
                <div>
                  <h3 className="text-xs font-black text-slate-900 tracking-widest uppercase">
                    External Stakeholders
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                    Client contacts with portal access
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="flex items-center gap-1.5 px-3 h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
              >
                <Plus size={12} strokeWidth={3} />
                {showAddForm ? "Cancel" : "Add Stakeholder"}
              </button>
            </div>

            {showAddForm && (
              <div className="mb-5 p-4 bg-slate-50 border border-slate-200 rounded-lg animate-in slide-in-from-top-2 duration-200">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      Full Name
                    </label>
                    <input
                      type="text"
                      value={newStakeholder.fullName}
                      onChange={(e) =>
                        setNewStakeholder({ ...newStakeholder, fullName: e.target.value })
                      }
                      placeholder="e.g. John Doe"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={newStakeholder.email}
                      onChange={(e) =>
                        setNewStakeholder({ ...newStakeholder, email: e.target.value })
                      }
                      placeholder="john@company.com"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={newStakeholder.role}
                      onChange={(e) =>
                        setNewStakeholder({ ...newStakeholder, role: e.target.value })
                      }
                      placeholder="e.g. Project Lead"
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
                    />
                  </div>
                </div>
                <button
                  onClick={addStakeholder}
                  disabled={loading || !newStakeholder.fullName}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Check size={12} strokeWidth={3} />
                  )}
                  Finalize Stakeholder
                </button>
              </div>
            )}

            {stakeholders.length === 0 ? (
              <div className="py-10 flex flex-col items-center bg-slate-50 border border-dashed border-slate-200 rounded-lg">
                <Mail className="w-8 h-8 text-slate-300 mb-2" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  No stakeholders listed yet
                </p>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Contact
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Designation
                      </th>
                      <th className="px-3 py-2.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        Portal
                      </th>
                      <th className="px-3 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {stakeholders.map((sh) => (
                      <tr
                        key={sh.id}
                        className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors group"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center font-black text-[10px] text-emerald-700 shrink-0">
                              {sh.fullName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-800 leading-tight">
                                {sh.fullName}
                              </p>
                              <p className="text-[10px] text-slate-400 leading-tight">
                                {sh.email}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <span className="text-xs text-slate-500">
                            {sh.role || "Stakeholder"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                              sh.hasPortalAccess
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                : "bg-slate-50 border-slate-200 text-slate-400"
                            }`}
                          >
                            <Globe size={8} />
                            {sh.hasPortalAccess ? "Active" : "No Access"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={() => deleteStakeholder(sh.id)}
                            className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-md transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="space-y-4">

          {/* ROADMAP SHARING */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                <Share size={16} />
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-900 tracking-widest uppercase">
                  Roadmap Sharing
                </h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">
                  External availability control
                </p>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed mb-5 p-3 bg-indigo-50/40 border border-indigo-100 rounded-lg italic">
              Stakeholders view progress with applied buffers. Internal tasks and budget data remain private.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                  Secure Export Link
                </label>
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1.5 pl-3 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                  <span className="text-[11px] text-slate-500 truncate flex-1 leading-none font-medium">
                    {shareLink ? (
                      shareLink
                    ) : (
                      <span className="text-slate-300 italic">Token not available...</span>
                    )}
                  </span>
                  <button
                    onClick={handleCopy}
                    disabled={!shareLink}
                    className={`h-8 w-8 rounded-md flex items-center justify-center transition-all ${
                      isCopied
                        ? "bg-emerald-500 text-white"
                        : "bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-30"
                    }`}
                  >
                    {isCopied ? (
                      <Check size={12} strokeWidth={3} />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>

              {shareLink ? (
                <a
                  href={shareLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-all group"
                >
                  <ExternalLink size={14} className="text-indigo-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-700 group-hover:text-slate-900 transition-colors">
                    Preview Client Portal
                  </span>
                </a>
              ) : (
                <div className="flex items-center justify-center gap-2 w-full py-2.5 bg-slate-50 border border-dashed border-slate-200 rounded-lg opacity-50 cursor-not-allowed">
                  <ExternalLink size={14} className="text-slate-300" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Preview Client Portal
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* ADVANCED LOCKDOWN */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex items-start gap-4 opacity-60">
            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 shrink-0 border border-slate-200">
              <Lock size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest">
                  Advanced Lockdown
                </h4>
                <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-[8px] font-black text-slate-400 uppercase tracking-widest rounded-full">
                  Coming Soon
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-snug">
                Restrict portal to approved domain stakeholders only.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
