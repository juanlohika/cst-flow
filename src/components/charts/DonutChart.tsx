"use client";

import React from "react";

interface DonutChartProps {
  completed: number;
  inProgress: number;
  pending: number;
  expectedProgress?: number; // 0 to 100
  actualProgressOverride?: number; // 0 to 100
  size?: number;
}

export default function DonutChart({
  completed = 0,
  inProgress = 0,
  pending = 0,
  expectedProgress = 0,
  actualProgressOverride,
  size = 220,
}: DonutChartProps) {
  const total = completed + inProgress + pending;
  const actualProgress = actualProgressOverride !== undefined 
    ? actualProgressOverride 
    : (total > 0 ? Math.round((completed / total) * 100) : 0);

  const center = size / 2;
  const outerWidth = 22;
  const innerWidth = 14;
  const gap = 8;
  
  const outerRadius = (size - outerWidth) / 2;
  const innerRadius = (size - outerWidth - innerWidth - gap * 2) / 2;

  const outerCircumference = 2 * Math.PI * outerRadius;
  const innerCircumference = 2 * Math.PI * innerRadius;

  // Outer Ring Calculation (Actual Task Completion)
  const actualOffset = outerCircumference - (actualProgress / 100) * outerCircumference;
  
  // Inner Ring Calculation (Expected Time Progress)
  const expectedOffset = innerCircumference - (expectedProgress / 100) * innerCircumference;

  const getStatusColor = () => {
    const diff = actualProgress - expectedProgress;
    if (diff <= -15) return "text-rose-500";
    if (diff <= -5) return "text-amber-500";
    return "text-emerald-500";
  };

  const getStatusBg = () => {
    const diff = actualProgress - expectedProgress;
    if (diff <= -15) return "bg-rose-50";
    if (diff <= -5) return "bg-amber-50";
    return "bg-emerald-50";
  };

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Outer Ring Background */}
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth={outerWidth}
          />
          
          {/* Outer Ring (Actual Progress) - Emerald */}
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            fill="transparent"
            stroke="#10b981"
            strokeWidth={outerWidth}
            strokeDasharray={outerCircumference}
            strokeDashoffset={actualOffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />

          {/* Inner Ring Background */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="transparent"
            stroke="#f8fafc"
            strokeWidth={innerWidth}
          />

          {/* Inner Ring (Expected Progress) - Slate-300 */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="transparent"
            stroke="#cbd5e1"
            strokeWidth={innerWidth}
            strokeDasharray={innerCircumference}
            strokeDashoffset={expectedOffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out opacity-60"
          />
        </svg>

        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className={`px-2 py-0.5 rounded-full mb-1 ${getStatusBg()}`}>
             <span className={`text-[9px] font-black uppercase tracking-widest ${getStatusColor()}`}>
               {actualProgress >= expectedProgress ? "Healthy" : "Delayed"}
             </span>
          </div>
          <span className="text-4xl font-black text-slate-800 leading-none">
            {actualProgress}%
          </span>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-2">
            Tasks Complete
          </span>
        </div>
      </div>

      {/* Comparison Legend */}
      <div className="mt-8 flex flex-col items-center gap-4 w-full px-4">
        <div className="flex items-center justify-between w-full pb-3 border-b border-slate-100">
           <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/20" />
              <div className="flex flex-col">
                 <span className="text-[10px] font-black text-slate-800 uppercase tracking-tight">Actual Progress</span>
                 <span className="text-[9px] font-bold text-slate-400">Tasks achieved to date</span>
              </div>
           </div>
           <span className="text-sm font-black text-emerald-600">{actualProgress}%</span>
        </div>

        <div className="flex items-center justify-between w-full">
           <div className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full bg-slate-300 shadow-sm" />
              <div className="flex flex-col">
                 <span className="text-[10px] font-black text-slate-800 uppercase tracking-tight">Expected Progress</span>
                 <span className="text-[9px] font-bold text-slate-400">Time elapsed vs deadline</span>
              </div>
           </div>
           <span className="text-sm font-black text-slate-500">{expectedProgress}%</span>
        </div>

        {actualProgress < expectedProgress && (
          <div className="mt-2 w-full bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-center gap-3">
             <div className="w-8 h-8 rounded-lg bg-rose-500 flex items-center justify-center shrink-0 shadow-lg shadow-rose-500/20 text-white font-black text-xs">!</div>
             <p className="text-[10px] font-bold text-rose-700 uppercase tracking-tight leading-normal">
                Project is trailing the expected timeline by {expectedProgress - actualProgress}%. 
                Consider resource reallocation.
             </p>
          </div>
        )}
      </div>
    </div>
  );
}
