"use client";

import React, { useState } from "react";
import { X, Calendar, MessageSquare, AlertCircle, ArrowRight } from "lucide-react";
import { useToast } from "@/components/ui/ToastContext";

interface ConfirmRescheduleModalProps {
  id: string;
  newStart: string;
  newEnd: string;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}

export default function ConfirmRescheduleModal({ id, newStart, newEnd, onClose, onConfirm }: ConfirmRescheduleModalProps) {
  const [comment, setComment] = useState("");
  const { showToast } = useToast();

  const handleConfirm = () => {
    if (!comment.trim()) {
      showToast("A remark for this schedule change is required", "error");
      return;
    }
    onConfirm(comment);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-500">
        
        <div className="p-7 border-b bg-slate-50/50 flex items-center justify-between">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-white shadow-sm">
                 <Calendar className="w-4 h-4" />
              </div>
              <h2 className="text-[11px] font-bold text-slate-800 tracking-widest uppercase">Reschedule Audit</h2>
           </div>
           <button onClick={onClose} className="text-slate-300 hover:text-slate-900 transition-colors">
              <X className="w-5 h-5" />
           </button>
        </div>

        <div className="p-7 space-y-6">
           <div className="space-y-3">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed px-1">
                 New Timeline Configuration:
              </p>
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between text-[11px] font-bold text-slate-600">
                 <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-300 mb-1 tracking-widest uppercase font-bold">START</span>
                    {newStart}
                 </div>
                 <ArrowRight className="w-3.5 h-3.5 text-slate-200" />
                 <div className="flex flex-col items-center">
                    <span className="text-[7px] text-slate-300 mb-1 tracking-widest uppercase font-bold">END</span>
                    {newEnd}
                 </div>
              </div>
           </div>

           <div className="space-y-3">
              <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1 flex items-center gap-2">
                 <MessageSquare className="w-3.5 h-3.5 text-primary opacity-60" /> Process Remarks
              </label>
              <textarea 
                 autoFocus
                 placeholder="Enter reason for timeline adjustment..."
                 className="w-full bg-slate-50/50 border border-slate-100 rounded-2xl p-4 text-[11px] font-bold text-slate-700 focus:ring-2 focus:ring-primary/5 transition-all outline-none min-h-[90px] placeholder:text-slate-200"
                 value={comment}
                 onChange={(e) => setComment(e.target.value)}
              />
           </div>

           <button 
             onClick={handleConfirm}
             className="w-full py-4 bg-slate-800 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-900 transition-all shadow-xl shadow-slate-100 active:scale-[0.98]"
           >
             Apply Adjustments
           </button>
        </div>
      </div>
    </div>
  );
}
