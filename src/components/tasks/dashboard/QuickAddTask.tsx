"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";

interface QuickAddTaskProps {
  onAdded?: () => void;
}

export default function QuickAddTask({ onAdded }: QuickAddTaskProps) {
  const [subject, setSubject] = useState("");
  const [projectId, setProjectId] = useState("");
  const [owner, setOwner] = useState("");
  const [durationHours, setDurationHours] = useState(8);
  const [projects, setProjects] = useState<any[]>([]);
  const [members, setMembers] = useState<{ roles: any[]; users: any[] }>({ roles: [], users: [] });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (projects.length === 0) {
        fetch("/api/projects").then(r => r.json()).then(data => {
          if (Array.isArray(data)) setProjects(data);
        }).catch(() => {});
      }
      if (members.roles.length === 0) {
        fetch("/api/users/members").then(r => r.json()).then(data => {
          setMembers(data);
          if (data.roles?.length > 0) setOwner(data.roles[0].name);
        }).catch(() => {});
      }
    }
  }, [open, projects.length, members.roles.length]);

  async function handleAdd() {
    if (!subject.trim() || !projectId) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          subject: subject.trim(),
          plannedStart: `${today}T09:00:00.000Z`,
          plannedEnd: `${today}T17:00:00.000Z`,
          owner,
          durationHours,
        }),
      });
      setSubject("");
      setOpen(false);
      onAdded?.();
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/30 text-[10px] font-bold uppercase tracking-widest transition-all w-full justify-center"
        >
          <Plus size={12} /> Quick Add Task
        </button>
      ) : (
        <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-2.5">
          <input
            autoFocus
            value={subject}
            onChange={e => setSubject(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Task subject…"
            className="w-full h-8 px-3 rounded-md border border-slate-200 text-[11px] font-semibold text-slate-700 placeholder-slate-300 focus:outline-none focus:border-blue-400"
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="h-7 px-2 text-[10px] rounded-md border border-slate-200 text-slate-600 bg-white outline-none focus:border-blue-400 col-span-2"
            >
              <option value="">Select project…</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select
              value={owner}
              onChange={e => setOwner(e.target.value)}
              className="h-7 px-2 text-[10px] font-bold rounded-md border border-slate-200 text-slate-600 bg-white outline-none focus:border-blue-400 uppercase"
            >
              {members.roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              {members.users.map(u => <option key={u.id} value={u.name || u.email}>{u.name || u.email}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={durationHours}
              onChange={e => setDurationHours(parseFloat(e.target.value) || 8)}
              className="w-16 h-7 px-2 text-[10px] font-bold rounded-md border border-slate-200 text-slate-700 outline-none focus:border-blue-400"
            />
            <span className="text-[9px] text-slate-400">hours</span>
            <div className="flex-1" />
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1 rounded-md text-[9px] font-bold text-slate-400 hover:bg-slate-100 uppercase transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!subject.trim() || !projectId || saving}
              className="px-3 py-1 rounded-md bg-primary text-white text-[9px] font-bold uppercase tracking-widest hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {saving ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
