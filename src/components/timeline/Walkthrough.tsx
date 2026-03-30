"use client";

import React from "react";
import { Sparkles, Calendar, MousePointer2, Layout, Zap, X } from "lucide-react";

interface WalkthroughProps {
  onClose: () => void;
}

export default function Walkthrough({ onClose }: WalkthroughProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-text-primary/60 backdrop-blur-md transition-all animate-in fade-in duration-500">
      <div className="bg-surface-default w-[90%] max-w-4xl rounded-[2.5rem] shadow-[0_32px_120px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col md:flex-row relative scale-100 animate-in zoom-in-95 duration-300">
        
        <button onClick={onClose} className="absolute top-6 right-6 p-2 rounded-full hover:bg-surface-muted transition-colors z-20">
          <X className="w-6 h-6 text-text-secondary" />
        </button>

        {/* Left Side: Illustration / Brand */}
        <div className="w-full md:w-[40%] bg-text-primary p-12 flex flex-col justify-between text-surface-default relative h-[300px] md:h-auto">
          <div className="space-y-4">
            <div className="h-14 w-14 bg-primary/20 rounded-2xl flex items-center justify-center border border-white/10 shadow-xl">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-3xl font-bold leading-tight tracking-tight">Meet the New <br /> Timeline Engine</h2>
            <p className="text-text-secondary text-sm leading-relaxed font-medium">Experience two powerful ways to visualize and manage your implementation roadmap.</p>
          </div>
          
          <div className="hidden md:block">
             <div className="flex gap-2">
                <div className="h-1.5 w-8 bg-primary rounded-full" />
                <div className="h-1.5 w-4 bg-white/20 rounded-full" />
                <div className="h-1.5 w-4 bg-white/20 rounded-full" />
             </div>
          </div>
        </div>

        {/* Right Side: Features */}
        <div className="flex-1 p-10 md:p-16 space-y-12">
          
          <div className="grid grid-cols-1 gap-10">
            
            <div className="flex gap-6 group">
              <div className="h-14 w-14 shrink-0 bg-primary-bg text-primary rounded-3xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                <Layout className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-text-primary">Dual Perspective</h4>
                <p className="text-text-secondary text-sm leading-relaxed">Choose between <b>Static Mode</b> for professional PNG exports, or <b>Interactive Mode</b> for live data manipulation.</p>
              </div>
            </div>

            <div className="flex gap-6 group">
              <div className="h-14 w-14 shrink-0 bg-amber-50 text-amber-600 rounded-3xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                <MousePointer2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-text-primary">Real-time Interactivity</h4>
                <p className="text-text-secondary text-sm leading-relaxed">Instantly update task owners, names, and durations in the frozen grid. Watch the Gantt bars snap to the new dates on the right.</p>
              </div>
            </div>

            <div className="flex gap-6 group">
              <div className="h-14 w-14 shrink-0 bg-violet-50 text-violet-600 rounded-3xl flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                <Zap className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-lg font-bold text-text-primary">Smart Guardrails</h4>
                <p className="text-text-secondary text-sm leading-relaxed">The engine automatically respects weekends and rest days during generation, ensuring your deployment dates are realistic.</p>
              </div>
            </div>

          </div>

          <button onClick={onClose} className="w-full bg-text-primary text-surface-default font-bold py-5 rounded-2xl shadow-2xl hover:bg-primary hover:translate-y-[-2px] active:translate-y-[0px] transition-all text-lg">
            Start Planning Now
          </button>
        </div>
      </div>
    </div>
  );
}
