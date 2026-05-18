"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";

interface Module {
  id: string;
  slug: string;
  label: string;
}

interface Props {
  value: string[];                  // selected slugs
  onChange: (next: string[]) => void;
  disabled?: boolean;
  allowAddNew?: boolean;            // admins can add new modules from the picker
}

/**
 * Tag-style multi-select for account modules. Loads the master list from
 * /api/account-modules and shows a dropdown with checkboxes. When the user
 * types a value that doesn't exist, an "Add as new module" button appears
 * (admin only).
 */
export default function ModulesPicker({ value, onChange, disabled, allowAddNew }: Props) {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account-modules");
      if (res.ok) {
        const data = await res.json();
        setModules(data.modules || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const labelBySlug = new Map(modules.map(m => [m.slug, m.label]));

  const toggle = (slug: string) => {
    if (value.includes(slug)) {
      onChange(value.filter(v => v !== slug));
    } else {
      onChange([...value, slug]);
    }
  };

  const filtered = modules.filter(m => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return m.label.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q);
  });

  const canAddNew = allowAddNew && search.trim().length > 0 && !modules.some(m =>
    m.label.toLowerCase() === search.toLowerCase() ||
    m.slug.toLowerCase() === search.toLowerCase()
  );

  const addNew = async () => {
    const label = search.trim();
    if (!label) return;
    setAdding(true);
    try {
      const res = await fetch("/api/account-modules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (res.ok && data?.slug) {
        await load();
        onChange([...value, data.slug]);
        setSearch("");
      } else {
        alert(data?.error || "Failed to add module");
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={`min-h-[40px] w-full px-2 py-1.5 border border-border-default rounded-md bg-white text-[13px] flex items-center flex-wrap gap-1.5 cursor-text ${disabled ? "bg-slate-50 cursor-not-allowed" : "focus-within:ring-2 focus-within:ring-primary"}`}
        onClick={() => !disabled && setOpen(true)}
      >
        {value.length === 0 && !open && (
          <span className="text-text-muted text-[12px]">Click to select modules…</span>
        )}
        {value.map(slug => (
          <span
            key={slug}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 rounded text-[11px] font-medium text-slate-700"
          >
            {labelBySlug.get(slug) || slug}
            {!disabled && (
              <button
                type="button"
                onClick={e => { e.stopPropagation(); toggle(slug); }}
                className="text-slate-400 hover:text-rose-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        {open && !disabled && (
          <input
            autoFocus
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search or type to add…"
            className="flex-1 min-w-[120px] outline-none border-none bg-transparent text-[12px]"
          />
        )}
      </div>

      {open && !disabled && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center p-3 text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : (
            <>
              {filtered.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggle(m.slug)}
                  className={`w-full px-3 py-2 text-left text-[12px] flex items-center gap-2 hover:bg-slate-50 ${value.includes(m.slug) ? "bg-indigo-50" : ""}`}
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${value.includes(m.slug) ? "bg-indigo-500 border-indigo-500" : "border-slate-300"}`}>
                    {value.includes(m.slug) && <span className="text-white text-[10px]">✓</span>}
                  </span>
                  <span className="text-slate-800">{m.label}</span>
                </button>
              ))}
              {filtered.length === 0 && !canAddNew && (
                <p className="text-[11px] text-slate-400 italic text-center py-3">No matching modules</p>
              )}
              {canAddNew && (
                <button
                  type="button"
                  onClick={addNew}
                  disabled={adding}
                  className="w-full px-3 py-2 text-left text-[12px] flex items-center gap-2 border-t border-slate-100 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold disabled:opacity-50"
                >
                  {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Add "{search}" as new module
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
