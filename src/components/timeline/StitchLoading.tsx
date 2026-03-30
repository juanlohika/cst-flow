"use client";

import React, { useState, useEffect } from "react";
import { Sparkles, Layers, Pencil, CheckCircle } from "lucide-react";

export default function StitchLoading() {
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const messages = [
    "Initializing Roadmap Engine...",
    "Analyzing Project Constraints...",
    "Allocating Team Resources...",
    "Generating Project Milestones...",
    "Optimizing Task Dependencies...",
    "Polishing Visual Timeline..."
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((oldProgress) => {
        if (oldProgress >= 100) {
          clearInterval(timer);
          return 100;
        }
        const diff = Math.random() * 1.5;
        return Math.min(oldProgress + diff, 100);
      });
    }, 100);

    const messageTimer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % messages.length);
    }, 2000);

    return () => {
      clearInterval(timer);
      clearInterval(messageTimer);
    };
  }, []);

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-white rounded-[3rem] shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-500 max-w-lg mx-auto">
      
      {/* Visual Canvas Loading */}
      <div className="relative w-32 h-32 mb-8">
        <div className="absolute inset-0 rounded-[2rem] bg-primary/5 animate-pulse" />
        <div className="absolute inset-4 rounded-[1.5rem] bg-primary/10 animate-ping duration-[3000ms]" />
        
        <div className="absolute inset-0 flex items-center justify-center">
            {progress < 30 && <Sparkles className="w-12 h-12 text-primary animate-bounce" />}
            {progress >= 30 && progress < 60 && <Layers className="w-12 h-12 text-primary animate-pulse" />}
            {progress >= 60 && progress < 90 && <Pencil className="w-12 h-12 text-primary rotate-12" />}
            {progress >= 90 && <CheckCircle className="w-12 h-12 text-emerald-500 animate-in zoom-in" />}
        </div>
      </div>

      <h2 className="text-xl font-black text-slate-800 mb-2 uppercase tracking-tight">
        Building your Roadmap
      </h2>
      
      <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-8 min-h-[1rem] transition-all">
        {messages[messageIndex]}
      </p>

      {/* Progress Track */}
      <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden shadow-inner mb-2 relative">
         <div 
          className="h-full bg-gradient-to-r from-primary via-sky-400 to-indigo-500 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
         />
         <div className="absolute inset-0 bg-gradient-to-r from-white/20 to-transparent animate-shimmer pointer-events-none" />
      </div>

      <div className="flex justify-between w-full px-1">
        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">{Math.round(progress)}% Complete</span>
        <span className="text-[10px] font-black text-primary uppercase tracking-widest">Stitch Engine v1.0</span>
      </div>

      <style jsx>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s infinite;
        }
      `}</style>
    </div>
  );
}
