"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, Check, ChevronDown, User, Shield, X } from "lucide-react";

interface UserSelectItem {
  id: string;
  name: string;
  email?: string;
  image?: string;
  type: "user" | "role";
}

interface UserSelectProps {
  value: string; // The ID or Name currently selected
  users: any[];
  roles: any[];
  onChange: (value: string) => void;
  onClose?: () => void;
  placeholder?: string;
}

export default function UserSelect({ 
  value, 
  users, 
  roles, 
  onChange, 
  onClose,
  placeholder = "Search user or role..." 
}: UserSelectProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Combine and format for display
  const allItems: UserSelectItem[] = [
    ...roles.map(r => ({ id: r.id, name: r.name, type: "role" as const })),
    ...users.map(u => ({ id: u.id, name: u.name || u.email, email: u.email, image: u.image, type: "user" as const }))
  ];

  const filteredItems = allItems.filter(item => 
    item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.email && item.email.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSelect = (item: UserSelectItem) => {
    onChange(item.name); // Using name as the identifier for now to match current Task logic
    if (onClose) onClose();
  };

  return (
    <div 
      ref={containerRef}
      className="flex flex-col w-64 max-h-80 bg-white border border-slate-200 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.12)] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      onClick={e => e.stopPropagation()}
    >
      {/* Search Bar */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100 bg-slate-50/50">
        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent border-none p-0 text-[11px] font-medium text-slate-700 placeholder:text-slate-400 outline-none"
          placeholder={placeholder}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <button onClick={() => setSearchTerm("")} className="p-0.5 text-slate-300 hover:text-slate-500 transition-colors">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto py-1 thin-scrollbar">
        {/* Roles Section */}
        {filteredItems.filter(i => i.type === "role").length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest">System Roles</div>
            {filteredItems.filter(i => i.type === "role").map(role => (
              <button
                key={`role-${role.id}`}
                onClick={() => handleSelect(role)}
                className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-all group ${
                  value === role.name ? "bg-primary/5 text-primary" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <Shield className={`w-3.5 h-3.5 ${value === role.name ? "text-primary" : "text-slate-400"}`} />
                  </div>
                  <span className="capitalize">{role.name.toLowerCase()}</span>
                </div>
                {value === role.name && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </>
        )}

        {/* Users Section */}
        {filteredItems.filter(i => i.type === "user").length > 0 && (
          <>
            <div className="px-3 py-1.5 text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">Approved Users</div>
            {filteredItems.filter(i => i.type === "user").map(user => (
              <button
                key={`user-${user.id}`}
                onClick={() => handleSelect(user)}
                className={`w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold transition-all group ${
                  value === user.name ? "bg-primary/5 text-primary" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  {user.image ? (
                    <img src={user.image} alt={user.name} className="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-slate-200" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 transition-colors">
                      <User className={`w-3.5 h-3.5 ${value === user.name ? "text-indigo-500" : "text-indigo-400"}`} />
                    </div>
                  )}
                  <div className="flex flex-col items-start leading-tight">
                    <span className="capitalize">{user.name.toLowerCase()}</span>
                    {user.email && <span className="text-[9px] font-normal text-slate-400 lowercase">{user.email}</span>}
                  </div>
                </div>
                {value === user.name && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </>
        )}

        {filteredItems.length === 0 && (
          <div className="p-8 text-center text-xs text-slate-400 italic">No matches found</div>
        )}
      </div>

      {/* Footer / TBD Option */}
      <div className="p-1.5 bg-slate-50 border-t border-slate-100">
        <button
          onClick={() => handleSelect({ id: "tbd", name: "TBD", type: "role" })}
          className={`w-full px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all ${
            value === "TBD" ? "bg-primary text-white shadow-sm shadow-primary/20" : "text-slate-400 hover:bg-white hover:text-slate-600 border border-transparent hover:border-slate-200"
          }`}
        >
          Unassign (TBD)
        </button>
      </div>
    </div>
  );
}
