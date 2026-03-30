"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";

interface Option {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface StitchDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  className?: string;
}

export default function StitchDropdown({ 
  options, 
  value, 
  onChange, 
  placeholder = "Select...", 
  icon,
  className = "" 
}: StitchDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find(o => o.id === value);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-6 py-4 bg-surface-default border border-border-default rounded-2xl transition-all duration-300 shadow-sm hover:border-primary/30 active:scale-[0.98] group ${isOpen ? 'ring-2 ring-primary/10 border-primary/50' : ''}`}
      >
        <div className="flex items-center gap-3">
          {icon && <div className="text-text-secondary group-hover:text-primary transition-colors">{icon}</div>}
          <div className="text-left">
            <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em] leading-none mb-1.5">{placeholder}</p>
            <p className="text-sm font-black text-text-primary tracking-tight leading-none uppercase">
              {selectedOption ? selectedOption.label : placeholder}
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-text-secondary transition-transform duration-300 ${isOpen ? 'rotate-180 text-primary' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-[calc(100%+8px)] left-0 right-0 z-[100] bg-surface-default border border-border-default rounded-[1.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.1)] overflow-hidden animate-in fade-in zoom-in-95 duration-200 backdrop-blur-md">
          <div className="p-2 max-h-[300px] overflow-y-auto thin-scrollbar">
            {options.map((option) => (
              <button
                key={option.id}
                onClick={() => {
                  onChange(option.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-200 group/item ${value === option.id ? 'bg-primary/5 text-primary' : 'hover:bg-surface-muted text-text-muted'}`}
              >
                <div className="flex items-center gap-3">
                  {option.icon && <div className={`${value === option.id ? 'text-primary' : 'text-text-secondary group-hover/item:text-text-muted'}`}>{option.icon}</div>}
                  <span className="text-[11px] font-black uppercase tracking-widest">{option.label}</span>
                </div>
                {value === option.id && <Check className="w-3.5 h-3.5" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
