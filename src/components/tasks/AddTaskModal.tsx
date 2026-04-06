"use client";

import React, { useState, useEffect } from "react";
import { X, Calendar, User, Clock, ArrowRight, Tag, Target, Loader2 } from "lucide-react";
import StitchTimePicker from "@/components/ui/StitchTimePicker";
import { useToast } from "@/components/ui/ToastContext";

interface AddTaskModalProps {
  projectId: string;
  parentId?: string;
  parentName?: string;
  parentDates?: { start: string; end: string };
  parentDurationHours?: number;
  allocatedHours?: number;
  onClose: () => void;
  onSuccess: () => void;
}

interface MemberUser { id: string; name: string; email: string; image?: string; }
interface MemberRole { id: string; name: string; }

export default function AddTaskModal({
  projectId,
  parentId,
  parentName,
  parentDates,
  parentDurationHours,
  allocatedHours,
  onClose,
  onSuccess,
}: AddTaskModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<{ users: MemberUser[]; roles: MemberRole[] }>({ users: [], roles: [] });
  const [assignType, setAssignType] = useState<"role" | "user">("role");

  const remainingHours =
    parentDurationHours != null ? Math.max(0, parentDurationHours - (allocatedHours ?? 0)) : null;

  const [formData, setFormData] = useState({
    subject: "",
    plannedStart: parentDates
      ? parentDates.start.split("T")[0]
      : new Date().toISOString().split("T")[0],
    plannedEnd: parentDates
      ? parentDates.end.split("T")[0]
      : new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0],
    owner: "PM",
    assignedTo: "",
    assignedIds: [] as string[],
    plannedStartTime: "09:00",
    plannedEndTime: "10:00",
    durationHours: remainingHours != null ? Math.min(remainingHours, 8) : 8,
  });

  useEffect(() => {
    fetch("/api/users/members")
      .then(r => r.ok ? r.json() : { users: [], roles: [] })
      .then(setMembers)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const startISO = `${formData.plannedStart}T${formData.plannedStartTime.padStart(5, "0")}:00Z`;
      const endISO = `${formData.plannedEnd}T${formData.plannedEndTime.padStart(5, "0")}:00Z`;

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          parentId,
          subject: formData.subject,
          owner: formData.owner || null,
          assignedTo: formData.assignedTo || null,
          assignedIds: formData.assignedIds,
          plannedStart: startISO,
          plannedEnd: endISO,
          durationHours: formData.durationHours,
        }),
      });

      if (res.ok) {
        showToast(parentId ? "Subtask created successfully" : "Task created successfully", "success");
        onSuccess();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to create task", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-md rounded-lg shadow-2xl border border-border overflow-hidden flex flex-col">

        {/* ── HEADER ── */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-primary flex items-center justify-center text-white shadow-sm shadow-primary/20">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-text-primary tracking-tight uppercase leading-none">
                {parentId ? "Add Subtask" : "New Task"}
              </h2>
              <p className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider mt-1">
                {parentId ? `Child of: ${parentName}` : "System Generated Reference"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary transition-all rounded-md hover:bg-surface-subtle">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── FORM ── */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 bg-surface-subtle">

          {/* Subject */}
          <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-2">
            <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Task Subject</label>
            <input
              required
              className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-semibold text-text-primary focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all outline-none uppercase placeholder:text-text-secondary placeholder:opacity-40 placeholder:font-normal placeholder:normal-case"
              placeholder="Enter task definition..."
              value={formData.subject}
              onChange={e => setFormData({ ...formData, subject: e.target.value })}
            />
          </div>

          {/* Dates + Time */}
          <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-primary-bg rounded-md flex items-center justify-center text-primary border border-primary-bg">
                <Calendar className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Schedule</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">Start</label>
                <input
                  type="date"
                  required
                  className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  value={formData.plannedStart}
                  onChange={e => setFormData({ ...formData, plannedStart: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider block">End</label>
                <input
                  type="date"
                  required
                  className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  value={formData.plannedEnd}
                  onChange={e => setFormData({ ...formData, plannedEnd: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-semibold text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Time Window
              </label>
              <StitchTimePicker
                defaultValue={{ start: formData.plannedStartTime, end: formData.plannedEndTime }}
                onSelect={(s, e) => setFormData(prev => ({ ...prev, plannedStartTime: s, plannedEndTime: e }))}
              />
            </div>
          </div>

          {/* Assignee */}
          <div className="bg-white rounded-lg border border-border shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 bg-primary-bg rounded-md flex items-center justify-center text-primary border border-primary-bg">
                <User className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">Assigned To</span>
            </div>

            {/* Type toggle */}
            <div className="flex gap-1 bg-surface-muted rounded-md p-0.5 w-fit">
              {(["role", "user"] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setAssignType(t);
                    if (t === "role") setFormData(f => ({ ...f, assignedTo: "", owner: members.roles[0]?.name || "PM" }));
                    else setFormData(f => ({ ...f, owner: "", assignedTo: members.users[0]?.id || "" }));
                  }}
                  className={`flex items-center gap-1 px-3 py-1 rounded-md text-[11px] font-medium transition-all ${
                    assignType === t ? "bg-white text-text-primary shadow-sm" : "text-text-secondary"
                  }`}
                >
                  {t === "role" ? <Tag className="w-3 h-3" /> : <User className="w-3 h-3" />}
                  {t === "role" ? "Role" : "User"}
                </button>
              ))}
            </div>

            {assignType === "role" ? (
              <select
                className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-semibold text-text-primary outline-none appearance-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                value={formData.owner}
                onChange={e => setFormData({ ...formData, owner: e.target.value, assignedTo: "" })}
              >
                {members.roles.map(r => <option key={r.id} value={r.name}>{r.name.toUpperCase()}</option>)}
                {members.roles.length === 0 && <option value="TBD">NO ROLES FOUND</option>}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-2 bg-surface-subtle border border-border rounded-md">
                  {formData.assignedIds.length === 0 && (
                    <span className="text-[10px] text-text-secondary opacity-40 font-medium italic">No users assigned</span>
                  )}
                  {formData.assignedIds.map(id => {
                    const u = members.users.find(m => m.id === id);
                    return (
                      <div key={id} className="inline-flex items-center gap-1.5 bg-primary-bg border border-primary/20 px-2 py-0.5 rounded-md">
                        <span className="text-[10px] font-semibold text-primary uppercase tracking-tight">{u?.name || "User"}</span>
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, assignedIds: prev.assignedIds.filter(aid => aid !== id) }))}
                          className="text-primary/40 hover:text-destructive transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <select
                  className="w-full bg-surface-subtle border border-border rounded-md px-3 py-2 text-sm font-semibold text-text-secondary outline-none appearance-none cursor-pointer hover:border-primary/50 focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  value=""
                  onChange={e => {
                    const val = e.target.value;
                    if (!val || formData.assignedIds.includes(val)) return;
                    setFormData(prev => ({ ...prev, assignedIds: [...prev.assignedIds, val] }));
                  }}
                >
                  <option value="">+ Add team member</option>
                  {members.users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-primary hover:bg-primary-hover text-white rounded-md text-xs font-semibold uppercase tracking-wider transition-all shadow-md shadow-primary/20 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? "Creating..." : "Confirm Task"}
          </button>
        </form>
      </div>
    </div>
  );
}
