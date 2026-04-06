"use client";

import React, { useState, useEffect } from "react";
import { 
  Users, UserPlus, Share, Copy, Check, 
  Shield, Trash2, Loader2, Link as LinkIcon,
  Archive, RotateCcw, ExternalLink
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface ProjectSettingsViewProps {
  project: any;
  profile?: any;
  onUpdate: () => void;
}

export default function ProjectSettingsView({ 
  project, 
  profile,
  onUpdate 
}: ProjectSettingsViewProps) {
  const [loading, setLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);

  useEffect(() => {
    if (project) {
      setAssignedIds(project.assignedIds ? (typeof project.assignedIds === 'string' ? project.assignedIds.split(',') : project.assignedIds) : []);
      loadUsers();
    }
  }, [project]);

  const loadUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(data.users || []);
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
      }
    } catch (err) {
      showToast("Failed to update team", "error");
    }
  };

  const handleToggleArchive = async () => {
    const action = project.archived ? "Unarchive" : "Archive";
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
        onUpdate();
      }
    } catch (err) {
      showToast("Operation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  if (!project) return null;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      
      {/* SECTION: Team Members (Internal) */}
      <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600">
                <Users className="w-5 h-5" />
             </div>
             <div>
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Internal Team</h3>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Team members assigned to this roadmap</p>
             </div>
          </div>
          <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-widest">
            {assignedIds.length} Members
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {availableUsers.map(user => {
            const isAssigned = assignedIds.includes(user.id);
            return (
              <div 
                key={user.id} 
                onClick={() => toggleUser(user.id)}
                className={`group flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${isAssigned ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-50 hover:border-slate-100 bg-slate-50/20'}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0 ${isAssigned ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
                      {user.name?.charAt(0)}
                   </div>
                   <div className="truncate">
                      <p className="text-sm font-bold text-slate-700 truncate">{user.name}</p>
                      <p className="text-[10px] text-slate-400 lowercase truncate">{user.email}</p>
                   </div>
                </div>
                <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all shrink-0 ${isAssigned ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-200 opacity-0 group-hover:opacity-100'}`}>
                   {isAssigned ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <UserPlus className="w-3.5 h-3.5" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* SECTION: Client Contacts (External) */}
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-8">
             <div className="w-10 h-10 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600">
                <Shield className="w-5 h-5" />
             </div>
             <div>
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Stakeholders</h3>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Primary client contacts</p>
             </div>
          </div>
          
          {profile ? (
            <div className="p-6 bg-slate-50 border border-slate-100 rounded-[2rem]">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Primary Decision Maker</p>
               <div className="space-y-4">
                  <div className="flex flex-col">
                     <span className="text-base font-black text-slate-700">{profile.primaryContact || "Unassigned"}</span>
                     <span className="text-xs font-bold text-slate-400 italic">{profile.primaryContactEmail || "No email provided"}</span>
                  </div>
                  <div className="pt-4 border-t border-slate-200/60">
                     <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">Company</p>
                     <p className="text-sm font-black text-slate-800">{profile.companyName}</p>
                  </div>
               </div>
            </div>
          ) : (
            <div className="py-12 flex flex-col items-center justify-center text-center opacity-40">
               <Shield className="w-12 h-12 text-slate-300 mb-2" />
               <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">No profile linked</p>
            </div>
          )}
        </div>

        {/* SECTION: Sharing & Access */}
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white relative overflow-hidden shadow-xl lg:row-span-2">
           <div className="relative z-10 flex flex-col h-full">
              <div className="flex items-center gap-3 mb-6">
                 <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/10">
                    <Share className="w-5 h-5 text-white" strokeWidth={2.5} />
                 </div>
                 <h4 className="text-lg font-black uppercase tracking-tight">Roadmap Sharing</h4>
              </div>
              <p className="text-slate-400 text-[13px] leading-relaxed mb-8 max-w-sm">
                This secure link allows the client to view the project roadmap with applied buffers. Internal tasks remain hidden.
              </p>
              
              <div className="space-y-4 mt-auto">
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-2 pl-6 backdrop-blur-sm">
                   <span className="text-[12px] font-medium text-slate-400 truncate italic flex-1">{shareLink || "Generating..."}</span>
                   <button 
                     onClick={handleCopy}
                     className={`h-12 w-12 rounded-xl flex items-center justify-center transition-all ${isCopied ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900 hover:scale-105'}`}
                   >
                     {isCopied ? <Check className="w-4 h-4" strokeWidth={3} /> : <Copy className="w-4 h-4" />}
                   </button>
                </div>
                
                <a 
                  href={shareLink || "#"} 
                  target="_blank"
                  className="flex items-center justify-center gap-2 w-full py-4 bg-white/10 hover:bg-white/15 border border-white/10 rounded-2xl transition-all group"
                >
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-white">Preview Portal</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100 transition-opacity" />
                </a>
              </div>
           </div>
           
           {/* Abstract decoration */}
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[100px] rounded-full -translate-y-1/2 translate-x-1/2" />
        </div>

        {/* SECTION: Administrative */}
        <div className="bg-white rounded-[2rem] border border-slate-100 p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
             <div className="w-10 h-10 bg-rose-50 rounded-2xl flex items-center justify-center text-rose-600">
                <Archive className="w-5 h-5" />
             </div>
             <div>
                <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Administration</h3>
                <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Archive or manage life-cycle</p>
             </div>
          </div>

          <button 
            onClick={handleToggleArchive}
            disabled={loading}
            className={`w-full py-5 rounded-2xl border transition-all flex items-center justify-center gap-3 group ${
              project.archived 
                ? 'bg-emerald-50 border-emerald-100 text-emerald-600 hover:bg-emerald-100' 
                : 'bg-white border-slate-100 text-slate-400 hover:bg-rose-50 hover:border-rose-100 hover:text-rose-600'
            }`}
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : project.archived ? (
              <RotateCcw className="w-5 h-5" />
            ) : (
              <Archive className="w-5 h-5 transition-transform group-hover:scale-110" />
            )}
            <span className="text-[11px] font-black uppercase tracking-[0.2em]">
              {project.archived ? "Restore Project" : "Archive Project"}
            </span>
          </button>
        </div>

      </div>
    </div>
  );
}
