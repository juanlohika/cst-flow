"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, Check, User, Shield, X, Users } from "lucide-react";

interface Item {
  id: string;
  name: string;
  email?: string;
  image?: string;
  type: "user" | "role";
}

interface MultiUserSelectProps {
  assignedIds: string[]; // User IDs
  role: string;       // Role Name
  users: any[];
  roles: any[];
  onChange: (assignedIds: string[], role: string) => void;
  onClose?: () => void;
}

export default function MultiUserSelect({
  assignedIds = [],
  role = "",
  users = [],
  roles = [],
  onChange,
  onClose,
}: MultiUserSelectProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<"user" | "role">(role ? "role" : "user");
  const containerRef = useRef<HTMLDivElement>(null);

  const filteredUsers = users.filter(u => 
    (u.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.email || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredRoles = roles.filter(r => 
    (r.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleUser = (userId: string) => {
    const next = assignedIds.includes(userId)
      ? assignedIds.filter(id => id !== userId)
      : [...assignedIds, userId];
    onChange(next, ""); // Clearing role if users are selected? (AddTaskModal logic was either/or)
  };

  const selectRole = (roleName: string) => {
    onChange([], roleName); // Clearing users if role is selected
    if (onClose) onClose();
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col w-72 max-h-96 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      onClick={e => e.stopPropagation()}
    >
      {/* Search & Tabs */}
      <div className="bg-slate-50/50 border-b border-slate-100 p-2 space-y-2">
        <div className="flex items-center gap-2 px-2 py-1.5 bg-white border border-slate-200 rounded-lg">
          <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            className="flex-1 bg-transparent border-none p-0 text-[11px] font-medium text-slate-700 outline-none"
            placeholder="Search team..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-1 bg-slate-200/50 rounded-lg p-0.5">
          <button 
            onClick={() => setActiveTab("user")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${activeTab === "user" ? "bg-white text-primary shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
          >
            <Users className="w-3 h-3" /> Team
          </button>
          <button 
            onClick={() => setActiveTab("role")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all ${activeTab === "role" ? "bg-white text-primary shadow-sm" : "text-slate-400 hover:text-slate-600"}`}
          >
            <Shield className="w-3 h-3" /> Roles
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1 thin-scrollbar">
        {activeTab === "user" ? (
          <div className="space-y-0.5">
            {filteredUsers.map(user => {
              const selected = assignedIds.includes(user.id);
              return (
                <button
                  key={user.id}
                  onClick={() => toggleUser(user.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 transition-colors group ${selected ? "bg-primary/5 shadow-inner" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors ${selected ? "bg-primary border-primary" : "bg-slate-50 border-slate-200 group-hover:bg-primary/10"}`}>
                      {user.image ? (
                        <img src={user.image} className="w-full h-full rounded-full object-cover" />
                      ) : (
                        <User className={`w-3.5 h-3.5 ${selected ? "text-white" : "text-slate-300"}`} />
                      )}
                    </div>
                    <div className="flex flex-col items-start">
                      <span className={`text-[11px] font-bold ${selected ? "text-primary" : "text-slate-600"}`}>{user.name || user.email}</span>
                      {user.email && <span className="text-[9px] text-slate-400 lowercase leading-none">{user.email}</span>}
                    </div>
                  </div>
                  {selected && <Check className="w-3.5 h-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="space-y-0.5">
            {filteredRoles.map(r => {
              const selected = role === r.name;
              return (
                <button
                  key={r.id}
                  onClick={() => selectRole(r.name)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors group ${selected ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${selected ? "bg-primary text-white shadow-lg shadow-primary/20" : "bg-slate-100 text-slate-400 group-hover:bg-primary/10"}`}>
                      <Shield className="w-4 h-4" />
                    </div>
                    <span className={`text-[11px] font-black uppercase tracking-widest ${selected ? "text-primary" : "text-slate-600"}`}>{r.name}</span>
                  </div>
                  {selected && <Check className="w-3.5 h-3.5 text-primary" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <button 
          onClick={() => { onChange([], ""); if (onClose) onClose(); }}
          className="px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors"
        >
          Clear All
        </button>
        {activeTab === "user" && assignedIds.length > 0 && (
          <button 
            onClick={onClose}
            className="px-4 py-1 bg-primary text-white rounded-md text-[9px] font-black uppercase tracking-widest hover:bg-primary-hover shadow-sm"
          >
            Done ({assignedIds.length})
          </button>
        )}
      </div>
    </div>
  );
}
