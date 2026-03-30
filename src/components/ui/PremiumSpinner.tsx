"use client";

import React from 'react';

export const PremiumSpinner = () => {
  return (
    <div className="relative w-12 h-12">
      <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-100 rounded-full"></div>
      <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-600 rounded-full border-t-transparent animate-spin shadow-[0_0_15px_rgba(37,99,235,0.3)]"></div>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
    </div>
  );
};

export const StitchLoading = () => {
  return (
    <div className="flex flex-col items-center gap-4 py-12">
      <PremiumSpinner />
      <div className="flex flex-col items-center">
        <span className="text-sm font-black text-slate-800 uppercase tracking-[0.2em] animate-pulse">
          CST FlowDesk
        </span>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
          Synchronizing Engine...
        </span>
      </div>
    </div>
  );
};
