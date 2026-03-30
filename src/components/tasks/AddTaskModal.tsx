"use client";

import React, { useState, useEffect } from "react";
import { X, Calendar, User, LayoutGrid, Target, Clock, ArrowRight, Info, Tag } from "lucide-react";
import StitchTimePicker from "@/components/ui/StitchTimePicker";
import { useToast } from "@/components/ui/ToastContext";

interface AddTaskModalProps {
  projectId: string;
  parentId?: string;
  parentName?: string;
  parentDates?: { start: string, end: string };
  parentDurationHours?: number;
  allocatedHours?: number;
  onClose: () => void;
  onSuccess: () => void;
}

interface MemberUser { id: string; name: string; email: string; image?: string; }
interface MemberRole { id: string; name: string; }

export default function AddTaskModal({ projectId, parentId, parentName, parentDates, parentDurationHours, allocatedHours, onClose, onSuccess }: AddTaskModalProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<{ users: MemberUser[]; roles: MemberRole[] }>({ users: [], roles: [] });
  const [assignType, setAssignType] = useState<"role" | "user">("role");

  const remainingHours = parentDurationHours != null
    ? Math.max(0, parentDurationHours - (allocatedHours ?? 0))
    : null;

  const [formData, setFormData] = useState({
    subject: "",
    plannedStart: parentDates ? parentDates.start.split('T')[0] : new Date().toISOString().split("T")[0],
    plannedEnd: parentDates ? parentDates.end.split('T')[0] : new Date(Date.now() + 86400000 * 7).toISOString().split("T")[0],
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
      const startISO = `${formData.plannedStart}T${formData.plannedStartTime.padStart(5, '0')}:00Z`;
      const endISO = `${formData.plannedEnd}T${formData.plannedEndTime.padStart(5, '0')}:00Z`;
      
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
    } catch (err) {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">

        {/* Header */}
        <div className="p-4 border-b bg-slate-50/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-white shadow shadow-primary/20">
                <Target className="w-4 h-4" />
             </div>
             <div>
                <h2 className="text-sm font-bold text-slate-800 tracking-tight uppercase leading-none">
                  {parentId ? "Add Subtask" : "New Task"}
                </h2>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5 opacity-60">
                  {parentId ? `Child of: ${parentName}` : "System Generated Reference"}
                </p>
             </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-300 hover:text-slate-900 transition-all rounded-md hover:bg-slate-100">
             <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Task Subject</label>
            <input
              required
              className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 focus:ring-2 focus:ring-primary/10 transition-all outline-none uppercase placeholder:text-slate-300"
              placeholder="Enter task definition..."
              value={formData.subject}
              onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                 <Calendar className="w-3 h-3 text-primary opacity-60" /> Start
              </label>
              <input
                type="date"
                required
                className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none"
                value={formData.plannedStart}
                onChange={(e) => setFormData({ ...formData, plannedStart: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                 <Calendar className="w-3 h-3 text-primary opacity-60" /> End
              </label>
              <input
                type="date"
                required
                className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none"
                value={formData.plannedEnd}
                onChange={(e) => setFormData({ ...formData, plannedEnd: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
               <Clock className="w-3 h-3 text-primary opacity-60" /> Time Window
            </label>
            <StitchTimePicker
               defaultValue={{ start: formData.plannedStartTime, end: formData.plannedEndTime }}
               onSelect={(s, e) => setFormData(prev => ({ ...prev, plannedStartTime: s, plannedEndTime: e }))}
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
               <User className="w-3 h-3 text-primary opacity-60" /> Assigned To
            </label>
            {/* Type toggle */}
            <div className="flex gap-1 bg-slate-100 rounded-md p-0.5 w-fit mb-1.5">
              <button type="button"
                onClick={() => { setAssignType("role"); setFormData(f => ({ ...f, assignedTo: "", owner: members.roles[0]?.name || "PM" })); }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${assignType === "role" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400"}`}>
                <Tag className="w-2.5 h-2.5 inline mr-1 opacity-70" />Role
              </button>
              <button type="button"
                onClick={() => { setAssignType("user"); setFormData(f => ({ ...f, owner: "", assignedTo: members.users[0]?.id || "" })); }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${assignType === "user" ? "bg-white text-slate-800 shadow-sm" : "text-slate-400"}`}>
                <User className="w-2.5 h-2.5 inline mr-1 opacity-70" />User
              </button>
            </div>

            {assignType === "role" ? (
              <select
                className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none appearance-none"
                value={formData.owner}
                onChange={(e) => setFormData({ ...formData, owner: e.target.value, assignedTo: "" })}
              >
                {members.roles.map(r => <option key={r.id} value={r.name}>{r.name.toUpperCase()}</option>)}
                {members.roles.length === 0 && <option value="TBD">NO ROLES FOUND</option>}
              </select>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5 min-h-[32px] p-1.5 bg-slate-50 border border-slate-100 rounded-md">
                  {formData.assignedIds.length === 0 && <span className="text-[10px] text-slate-300 font-medium italic">No users assigned</span>}
                  {formData.assignedIds.map(id => {
                    const u = members.users.find(m => m.id === id);
                    return (
                      <div key={id} className="inline-flex items-center gap-1.5 bg-white border border-slate-200 px-2 py-0.5 rounded-lg shadow-sm">
                        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-tight">{u?.name || "User"}</span>
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({ ...prev, assignedIds: prev.assignedIds.filter(aid => aid !== id) }))}
                          className="text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                
                <select
                  className="w-full bg-slate-50 border border-slate-100 rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 outline-none appearance-none cursor-pointer"
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
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-slate-900 text-white rounded-md text-[10px] font-bold uppercase tracking-widest hover:bg-black transition-all shadow active:scale-[0.98]"
          >
            {loading ? "Creating..." : "Confirm Task"}
          </button>
        </form>
      </div>
    </div>
  );
}
