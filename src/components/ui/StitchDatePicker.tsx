"use client";

import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";

interface StitchDatePickerProps {
  onSelect: (date: Date) => void;
  selectedDate?: Date;
}

export default function StitchDatePicker({ onSelect, selectedDate }: StitchDatePickerProps) {
  const [currentMonth, setCurrentMonth] = useState(selectedDate || new Date());
  
  const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const firstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const handleDayClick = (day: number) => {
    const selected = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    onSelect(selected);
  };

  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));

  const days = Array.from({ length: daysInMonth(currentMonth.getFullYear(), currentMonth.getMonth()) }, (_, i) => i + 1);
  const startOffset = firstDayOfMonth(currentMonth.getFullYear(), currentMonth.getMonth());

  return (
    <div className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-xl w-72">
      <div className="flex items-center justify-between mb-6">
        <button onClick={prevMonth} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tighter">
            {currentMonth.toLocaleString('default', { month: 'long' })}
          </h3>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{currentMonth.getFullYear()}</p>
        </div>
        <button onClick={nextMonth} className="p-2 hover:bg-slate-50 rounded-xl text-slate-400">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={`header-${d}-${i}`} className="text-[9px] font-black text-slate-300 text-center uppercase">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`empty-${i}`} className="h-9" />
        ))}
        {days.map(d => {
          const isSelected = selectedDate?.getDate() === d && selectedDate?.getMonth() === currentMonth.getMonth();
          return (
            <button
              key={d}
              onClick={() => handleDayClick(d)}
              className={`h-9 rounded-xl flex items-center justify-center text-[11px] font-bold transition-all ${
                isSelected ? 'bg-primary text-white shadow-lg shadow-primary/20 scale-110' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}
