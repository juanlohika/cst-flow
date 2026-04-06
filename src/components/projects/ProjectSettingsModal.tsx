"use client";

import React, { useState, useEffect } from "react";
import { 
  X, Users, UserPlus, Mail, Share, Copy, Check, 
  Settings, Shield, Trash2, Loader2, Link as LinkIcon
} from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface ProjectSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: any;
  profile?: any;
  onUpdate: () => void;
}

export default function ProjectSettingsModal({ 
  isOpen, 
  onClose, 
  project, 
  profile,
  onUpdate 
}: ProjectSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"internal" | "external" | "share">("internal");
  const [loading, setLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const { showToast } = useToast();

  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [availableUsers, setAvailableUsers] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen && project) {
      setAssignedIds(project.assignedIds ? (typeof project.assignedIds === 'string' ? project.assignedIds.split(',') : project.assignedIds) : []);
      loadUsers();
    }
  }, [isOpen, project]);

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
    
    // Auto-save on toggle
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

  if (!isOpen || !project) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl h-[600px] overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-200 flex flex-col">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
           <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                 <Settings className="w-5 h-5" />
              </div>
              <div>
                 <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight">Project Management</h3>
                 <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">{project.name}</p>
              </div>
           </div>
           <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-all text-slate-400">
              <X className="w-5 h-5" />
           </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
           {(["internal", "external", "share"] as const).map(tab => (
             <button
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`flex-1 py-4 text-[10px] font-black uppercase tracking-widest transition-all relative ${activeTab === tab ? "text-primary" : "text-slate-400 hover:text-slate-600"}`}
             >
               {tab === 'internal' ? 'Team Members' : tab === 'external' ? 'Client Contacts' : 'Sharing & Access'}
               {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-primary rounded-t-full" />}
             </button>
           ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 styled-scroll">
           {activeTab === "internal" && (
             <div className="space-y-6">
                <div className="flex items-center justify-between mb-2">
                   <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Assigned Team</h4>
                   <span className="text-[10px] font-bold text-primary bg-primary/5 px-2 py-0.5 rounded-full">{assignedIds.length} Members</span>
                </div>
                
                <div className="grid grid-cols-1 gap-2">
                   {availableUsers.map(user => {
                     const isAssigned = assignedIds.includes(user.id);
                     return (
                       <div 
                        key={user.id} 
                        onClick={() => toggleUser(user.id)}
                        className={`group flex items-center justify-between p-4 rounded-2xl border transition-all cursor-pointer ${isAssigned ? 'border-primary bg-primary/5' : 'border-slate-100 hover:border-slate-200 bg-white'}`}
                       >
                         <div className="flex items-center gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs ${isAssigned ? 'bg-primary text-white' : 'bg-slate-100 text-slate-400'}`}>
                               {user.name?.charAt(0)}
                            </div>
                            <div>
                               <p className="text-sm font-bold text-slate-700">{user.name}</p>
                               <p className="text-[10px] text-slate-400 italic lowercase">{user.email}</p>
                            </div>
                         </div>
                         <div className={`w-6 h-6 rounded-lg flex items-center justify-center transition-all ${isAssigned ? 'bg-primary text-white' : 'border border-slate-200 text-slate-200 opacity-0 group-hover:opacity-100'}`}>
                            {isAssigned ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : <UserPlus className="w-3.5 h-3.5" />}
                         </div>
                       </div>
                     );
                   })}
                </div>
             </div>
           )}

           {activeTab === "external" && (
             <div className="space-y-8 flex flex-col items-center justify-center h-full text-center py-10">
                <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-4">
                   <Users className="w-10 h-10 text-slate-200" />
                </div>
                <div className="max-w-xs">
                   <h4 className="text-lg font-black text-slate-800 uppercase tracking-tight">Client Contacts</h4>
                   <p className="text-slate-400 text-sm mt-2">Manage the direct client stakeholders who will receive notifications and access to this roadmap.</p>
                </div>
                
                {profile?.primaryContact && (
                   <div className="w-full max-w-sm bg-slate-50 border border-slate-100 rounded-3xl p-6 text-left">
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-primary shadow-sm">
                            <Shield className="w-6 h-6" />
                         </div>
                         <div>
                            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Primary Decision Maker</p>
                            <p className="text-base font-black text-slate-800">{profile.primaryContact}</p>
                            <p className="text-xs font-medium text-slate-500 italic">{profile.primaryContactEmail}</p>
                         </div>
                      </div>
                   </div>
                )}
             </div>
           )}

           {activeTab === "share" && (
             <div className="space-y-8 py-4">
                <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden shadow-2xl">
                   <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-6">
                         <div className="w-10 h-10 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center">
                            <Share className="w-5 h-5 text-white" strokeWidth={2.5} />
                         </div>
                         <h4 className="text-lg font-black uppercase tracking-tight">Public Roadmap Share</h4>
                      </div>
                      <p className="text-slate-400 text-[13px] leading-relaxed mb-8 max-w-md">
                        This secure link allows the client to view a padded version of the project roadmap without seeing internal task details.
                      </p>
                      
                      <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-2 pl-6 backdrop-blur-sm">
                         <span className="text-[12px] font-medium text-slate-300 truncate italic flex-1">{shareLink || "Generating..."}</span>
                         <button 
                           onClick={handleCopy}
                           className={`h-12 px-6 rounded-xl flex items-center gap-2 transition-all ${isCopied ? 'bg-emerald-500 text-white' : 'bg-white text-slate-900 hover:scale-105 active:scale-95'}`}
                         >
                           {isCopied ? <Check className="w-4 h-4" strokeWidth={3} /> : <Copy className="w-4 h-4" />}
                           <span className="text-[11px] font-black uppercase tracking-widest">{isCopied ? 'Copied' : 'Copy Link'}</span>
                         </button>
                      </div>
                   </div>
                   
                   {/* Abstract decoration */}
                   <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[120px] rounded-full -translate-y-1/2 translate-x-1/2" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                      <Mail className="w-5 h-5 text-slate-400 mb-3" />
                      <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-1">Email Invitation</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">Directly invite participants to view the roadmap via secure token.</p>
                   </div>
                   <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 opacity-50 cursor-not-allowed">
                      <Shield className="w-5 h-5 text-slate-400 mb-3" />
                      <p className="text-[11px] font-black text-slate-800 uppercase tracking-widest mb-1">Revoke Access</p>
                      <p className="text-[10px] text-slate-400 leading-relaxed">Disable the share link and generate a new token (Coming Soon).</p>
                   </div>
                </div>
             </div>
           )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-slate-50/30 flex justify-end">
           <button 
             onClick={onClose}
             className="px-8 h-12 bg-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] shadow-lg hover:shadow-slate-900/10 active:scale-95 transition-all"
           >
             Finish Setup
           </button>
        </div>
      </div>
    </div>
  );
}
