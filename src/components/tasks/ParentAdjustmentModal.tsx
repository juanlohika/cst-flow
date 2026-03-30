"use client";

import React from "react";
import { AlertCircle, ArrowRight, Calendar, X } from "lucide-react";

interface ParentAdjustmentModalProps {
  parentName: string;
  parentOldStart: string;
  parentOldEnd: string;
  parentNewStart: string;
  parentNewEnd: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ParentAdjustmentModal({
  parentName,
  parentOldStart,
  parentOldEnd,
  parentNewStart,
  parentNewEnd,
  onConfirm,
  onCancel
}: ParentAdjustmentModalProps) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)] border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-500">
        
        <div className="p-8 border-b bg-rose-50/50 flex items-center justify-between">
           <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-200">
                 <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                 <h2 className="text-sm font-bold text-slate-800 tracking-widest uppercase">Timeline Conflict</h2>
                 <p className="text-[9px] font-bold text-rose-400 uppercase tracking-widest mt-1">Cascading Update Required</p>
              </div>
           </div>
           <button onClick={onCancel} className="text-slate-300 hover:text-slate-900 transition-colors">
              <X className="w-6 h-6" />
           </button>
        </div>

        <div className="p-8 space-y-6">
           <p className="text-[11px] font-bold text-slate-500 leading-relaxed text-center px-4">
             The subtask&apos;s new schedule exceeds the current range of its parent:
             <span className="text-slate-900 block mt-1 uppercase">&quot;{parentName}&quot;</span>
           </p>

           <div className="space-y-4">
              <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl flex flex-col items-center gap-3">
                 <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Parent Schedule Expansion</span>
                 <div className="flex items-center gap-4 text-[11px] font-bold text-slate-700">
                    <span className="opacity-40">{new Date(parentOldStart).toLocaleDateString()}</span>
                    <ArrowRight className="w-4 h-4 text-slate-200" />
                    <span className="text-rose-500">{new Date(parentNewStart).toLocaleDateString()}</span>
                 </div>
                 <div className="flex items-center gap-4 text-[11px] font-bold text-slate-700">
                    <span className="opacity-40">{new Date(parentOldEnd).toLocaleDateString()}</span>
                    <ArrowRight className="w-4 h-4 text-slate-200" />
                    <span className="text-rose-500">{new Date(parentNewEnd).toLocaleDateString()}</span>
                 </div>
              </div>
           </div>

           <div className="space-y-3">
              <button 
                onClick={onConfirm}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-black transition-all shadow-xl active:scale-[0.98]"
              >
                Confirm Cascading Update
              </button>
              <button 
                onClick={onCancel}
                className="w-full py-4 bg-white border border-slate-100 text-slate-400 rounded-2xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-[0.98]"
              >
                Cancel Adjustment
              </button>
           </div>
        </div>
      </div>
    </div>
  );
}
