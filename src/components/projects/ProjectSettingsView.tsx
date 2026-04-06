"use client";

import React, { useState, useEffect } from "react";
import { 
  Users, UserPlus, Share, Copy, Check, 
  Shield, Trash2, Loader2, Link as LinkIcon,
  Archive, RotateCcw, ExternalLink, Plus, Mail,
  Settings2, Globe, Lock
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface ProjectSettingsViewProps {
  project: any;
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
  onUpdate 
}: ProjectSettingsViewProps) {
  const [loading, setLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);
  const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);
  const [showAddStakeholder, setShowAddStakeholder] = useState(false);
  const [newStakeholder, setNewStakeholder] = useState({ fullName: "", email: "", role: "" });

  useEffect(() => {
    if (project?.id) {
      const ids = project.assignedIds ? (typeof project.assignedIds === 'string' ? project.assignedIds.split(',').filter(Boolean) : project.assignedIds) : [];
      setAssignedIds(ids);
      loadUsers();
      loadStakeholders();
    }
  }, [project?.id]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(data.users || []);
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

  const shareLink = project?.shareToken ? `${window.location.origin}/share/${project.shareToken}` : null;

  const handleCopy = () => {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink);
    setIsCopied(true);
    showToast("Link copied!", "success");
    setTimeout(() => setIsCopied(false), 2000);
  };

  const toggleUser = async (userId: string) => {
    const newIds = assignedIds.includes(userId) 
      ? assignedIds.filter(id => id !== userId)
      : [...assignedIds, userId];
    
    setAssignedIds(newIds);
    
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedIds: newIds.join(',') })
      });
      if (res.ok) {
        onUpdate();
        showToast(assignedIds.includes(userId) ? "Removed from team" : "Added to team", "success");
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
        body: JSON.stringify(newStakeholder)
      });
      if (res.ok) {
        showToast("Stakeholder added", "success");
        setNewStakeholder({ fullName: "", email: "", role: "" });
        setShowAddStakeholder(false);
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
      const res = await fetch(`/api/projects/${project.id}/stakeholders?stakeholderId=${id}`, {
        method: "DELETE"
      });
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
        body: JSON.stringify({ archived: !project.archived })
      });
      if (res.ok) {
        showToast(`Project ${project.archived ? "restored" : "archived"}`, "success");
        window.location.reload(); 
      }
    } catch (err) {
      showToast("Operation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!project) return null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-6xl mx-auto pb-24">
      
      {/* HEADER SECTION */}
      <div className="flex items-center justify-between">
        <div>
           <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 bg-primary/10 text-primary text-[9px] font-black uppercase tracking-widest rounded">Project Configuration</span>
              <span className="w-1 h-1 bg-slate-200 rounded-full" />
              <span className="text-[10px] font-bold text-slate-400">ID: {project.id}</span>
           </div>
           <h2 className="text-3xl font-black text-slate-900 tracking-tight">{project.name || "Untitled Project"}</h2>
        </div>
        
        <button 
          onClick={handleToggleArchive}
          disabled={loading}
          className={`flex items-center gap-2 px-6 py-3 rounded-2xl border transition-all font-black text-[10px] uppercase tracking-widest ${
            project.archived 
              ? 'bg-emerald-50 border-emerald-100 text-emerald-600 hover:bg-emerald-100' 
              : 'bg-white border-slate-100 text-slate-400 hover:bg-rose-50 hover:border-rose-100 hover:text-rose-600'
          }`}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : project.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
          {project.archived ? "Restore Roadmap" : "Archive Roadmap"}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* INTERNAL TEAM CONTROL */}
        <div className="lg:col-span-2 space-y-6">
           <div className="bg-white rounded-[2.5rem] border border-slate-100 p-10 shadow-sm">
              <div className="flex items-center justify-between mb-10">
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm border border-indigo-100/50">
                       <Users size={22} />
                    </div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Internal Team</h3>
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">Personnel assigned to this roadmap</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-2 bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100/50">
                    <span className="text-lg font-black text-indigo-600 leading-none">{assignedIds.length}</span>
                    <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Members</span>
                 </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 {availableUsers.map(user => {
                    const isAssigned = assignedIds.includes(user.id);
                    return (
                       <div 
                          key={user.id}
                          onClick={() => toggleUser(user.id)}
                          className={`group flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${isAssigned ? 'border-indigo-100 bg-indigo-50/20' : 'border-slate-50 bg-slate-50/10 hover:border-slate-200'}`}
                       >
                          <div className="flex items-center gap-3 min-w-0">
                             <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0 transition-colors ${isAssigned ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                                {user.name?.charAt(0)}
                             </div>
                             <div className="truncate">
                                <p className="text-xs font-bold text-slate-800 truncate leading-tight mb-0.5">{user.name}</p>
                                <p className="text-[9px] font-medium text-slate-400 lowercase truncate leading-tight uppercase tracking-tight">{user.email}</p>
                             </div>
                          </div>
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center border transition-all ${isAssigned ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'border-slate-200 text-slate-200 opacity-0 group-hover:opacity-100'}`}>
                             {isAssigned ? <Check size={12} strokeWidth={4} /> : <Plus size={12} strokeWidth={4} />}
                          </div>
                       </div>
                    );
                 })}
              </div>
           </div>

           {/* STAKEHOLDERS CRUD */}
           <div className="bg-white rounded-[2.5rem] border border-slate-100 p-10 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-8">
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100/50">
                       <Shield size={22} />
                    </div>
                    <div>
                       <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">External Stakeholders</h3>
                       <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">Client contacts with portal access</p>
                    </div>
                 </div>
                 <button 
                    onClick={() => setShowAddStakeholder(!showAddStakeholder)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-md shadow-emerald-200"
                 >
                    {showAddStakeholder ? <RotateCcw size={14} /> : <Plus size={14} />}
                    {showAddStakeholder ? "Cancel" : "Add Stakeholder"}
                 </button>
              </div>

              {showAddStakeholder && (
                 <div className="mb-8 p-6 bg-emerald-50/30 border border-emerald-100 rounded-[2rem] animate-in slide-in-from-top-4 duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest ml-2">Full Name</label>
                          <input 
                             type="text" 
                             value={newStakeholder.fullName}
                             onChange={e => setNewStakeholder({...newStakeholder, fullName: e.target.value})}
                             placeholder="e.g. John Doe" 
                             className="w-full px-4 py-3 bg-white border border-emerald-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                          />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest ml-2">Email Address</label>
                          <input 
                             type="email" 
                             value={newStakeholder.email}
                             onChange={e => setNewStakeholder({...newStakeholder, email: e.target.value})}
                             placeholder="john@company.com" 
                             className="w-full px-4 py-3 bg-white border border-emerald-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                          />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[9px] font-black text-emerald-700 uppercase tracking-widest ml-2">Designation</label>
                          <input 
                             type="text" 
                             value={newStakeholder.role}
                             onChange={e => setNewStakeholder({...newStakeholder, role: e.target.value})}
                             placeholder="e.g. Project Lead" 
                             className="w-full px-4 py-3 bg-white border border-emerald-100 rounded-xl text-xs font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/20 transition-all"
                          />
                       </div>
                    </div>
                    <button 
                       onClick={addStakeholder}
                       disabled={loading || !newStakeholder.fullName}
                       className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                    >
                       {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                       Finalize Stakeholder
                    </button>
                 </div>
              )}

              <div className="space-y-3">
                 {stakeholders.length === 0 ? (
                    <div className="py-12 flex flex-col items-center text-center bg-slate-50/50 border border-dashed border-slate-200 rounded-[2rem]">
                       <Mail className="w-10 h-10 text-slate-200 mb-3" />
                       <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No stakeholders listed yet</p>
                    </div>
                 ) : (
                    stakeholders.map(sh => (
                       <div key={sh.id} className="flex items-center justify-between p-5 bg-white border border-slate-100 rounded-[2rem] hover:border-emerald-200 hover:shadow-sm transition-all group">
                          <div className="flex items-center gap-4">
                             <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 font-black text-xs border border-emerald-100/50">
                                {sh.fullName.charAt(0)}
                             </div>
                             <div>
                                <h4 className="text-sm font-black text-slate-800 leading-tight mb-0.5">{sh.fullName}</h4>
                                <div className="flex items-center gap-2">
                                   <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{sh.role || "Stakeholder"}</span>
                                   <span className="w-1 h-1 bg-slate-200 rounded-full" />
                                   <span className="text-[9px] font-medium text-emerald-600 lowercase tracking-tight">{sh.email}</span>
                                </div>
                             </div>
                          </div>
                          <div className="flex items-center gap-2">
                             <div className={`px-3 py-1.5 rounded-lg flex items-center gap-2 text-[9px] font-black uppercase tracking-widest border transition-colors ${sh.hasPortalAccess ? 'bg-emerald-50 border-emerald-100 text-emerald-600' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                                <Globe size={10} />
                                {sh.hasPortalAccess ? "Portal Access Active" : "No Access"}
                             </div>
                             <button 
                                onClick={() => deleteStakeholder(sh.id)}
                                className="w-9 h-9 flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                             >
                                <Trash2 size={16} />
                             </button>
                          </div>
                       </div>
                    ))
                 )}
              </div>
           </div>
        </div>

        {/* ROADMAP SHARING & ACCESS */}
        <div className="space-y-6">
           <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm relative overflow-hidden flex flex-col min-h-[400px]">
              <div className="flex items-center gap-4 mb-8">
                 <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                    <Share size={22} />
                 </div>
                 <div>
                    <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Roadmap Sharing</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mt-1">External availability control</p>
                 </div>
              </div>

              <div className="p-8 bg-indigo-50/30 border border-indigo-100/50 rounded-[2rem] text-slate-600 text-sm leading-relaxed mb-10 italic">
                 "This secure link allows current stakeholders to view progress with applied buffers. Internal tasks and budget data remain private."
              </div>

              <div className="space-y-4 mt-auto">
                 <div className="flex flex-col gap-1.5">
                    <label className="text-[9px] font-black text-indigo-700 uppercase tracking-widest ml-4">Secure Export Link</label>
                    <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl p-2 pl-6 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all shadow-sm">
                       <span className="text-[11px] font-medium text-slate-400 truncate flex-1 leading-none">{shareLink || "Generating..."}</span>
                       <button 
                          onClick={handleCopy}
                          className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all shadow-sm ${isCopied ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white hover:scale-105'}`}
                       >
                          {isCopied ? <Check size={14} strokeWidth={3} /> : <Copy size={14} />}
                       </button>
                    </div>
                 </div>

                 <a 
                    href={shareLink || "#"} 
                    target="_blank"
                    className="flex items-center justify-center gap-3 w-full py-4 bg-white hover:bg-slate-50 border-2 border-slate-100 rounded-2xl transition-all group mt-2"
                 >
                    <Settings2 size={16} className="text-slate-400 group-hover:text-primary transition-colors" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-600 group-hover:text-slate-900 transition-colors">Preview Client Portal</span>
                    <ExternalLink size={14} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
                 </a>
              </div>

              {/* Decorative detail */}
              <div className="absolute bottom-0 right-0 w-32 h-32 bg-indigo-50 rounded-full blur-[60px] opacity-20 -translate-y-4 translate-x-4" />
           </div>

           <div className="bg-slate-50 border border-slate-100 rounded-[2.5rem] p-8 flex items-center gap-6">
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100 text-slate-400">
                 <Lock size={24} />
              </div>
              <div className="flex-1">
                 <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight mb-1">Advanced Lockdown</h4>
                 <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-snug">Restrict portal to approved domain stakeholders only.</p>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
}
