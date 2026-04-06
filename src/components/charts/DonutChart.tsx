"use client";

import React from "react";

interface DonutChartProps {
  completed: number;
  inProgress: number;
  pending: number;
  size?: number;
  strokeWidth?: number;
}

export default function DonutChart({
  completed = 0,
  inProgress = 0,
  pending = 0,
  size = 200,
  strokeWidth = 24
}: DonutChartProps) {
  const total = completed + inProgress + pending;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Calculate offsets
  const completedOffset = circumference - (completed / total) * circumference;
  const inProgressOffset = circumference - ((completed + inProgress) / total) * circumference;
  const pendingOffset = circumference - ((completed + inProgress + pending) / total) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#f1f5f9"
            strokeWidth={strokeWidth}
          />
          
          {/* Pending segment (Slate) */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#94a3b8"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={0}
            className="transition-all duration-1000 ease-out"
          />

          {/* In Progress segment (Slate-800 / Navy) */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#1e293b"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={inProgressOffset}
            className="transition-all duration-1000 ease-out"
          />

          {/* Completed segment (Emerald) */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="#10b981"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={completedOffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>

        {/* Center Content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-black text-slate-800 leading-none">
            {percentage}%
          </span>
          <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            Complete
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 flex flex-wrap justify-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Done ({completed})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-800" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Active ({inProgress})</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Waiting ({pending})</span>
        </div>
      </div>
    </div>
  );
}
