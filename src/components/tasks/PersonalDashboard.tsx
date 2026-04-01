"use client";

import { useState } from "react";
import { RefreshCw, LayoutDashboard } from "lucide-react";
import { useDashboard } from "@/lib/hooks/useDashboard";
import TodayFocusPanel from "@/components/tasks/dashboard/TodayFocusPanel";
import CriticalPanel from "@/components/tasks/dashboard/CriticalPanel";
import WorkloadHeatmap from "@/components/tasks/dashboard/WorkloadHeatmap";
import ProjectHealthGrid from "@/components/tasks/dashboard/ProjectHealthGrid";
import RecurringMaintenancePanel from "@/components/tasks/dashboard/RecurringMaintenancePanel";
import AiDayPlannerPanel from "@/components/tasks/dashboard/AiDayPlannerPanel";
import ActivityFeedPanel from "@/components/tasks/dashboard/ActivityFeedPanel";
import QuickAddTask from "@/components/tasks/dashboard/QuickAddTask";
import ManHoursPanel from "@/components/tasks/dashboard/ManHoursPanel";
import KanbanStatusPanel from "@/components/tasks/dashboard/KanbanStatusPanel";

function PanelCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col ${className}`}>
      <div className="px-4 py-3 border-b border-slate-50 bg-[#FCFCFC] rounded-t-xl">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</h3>
      </div>
      <div className="flex-1 p-4 overflow-auto thin-scrollbar">
        {children}
      </div>
    </div>
  );
}

export default function PersonalDashboard() {
  const [viewMode, setViewMode] = useState<'mine'|'all'>('mine');
  const { data, loading, error, refresh } = useDashboard(viewMode);

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50/60">
      {/* Header */}
      <div className="px-6 py-4 border-b bg-white flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <LayoutDashboard size={16} className="text-primary" />
          <div>
            <h1 className="text-[13px] font-black text-slate-800 uppercase tracking-tight">
              {viewMode === 'mine' ? 'My Dashboard' : 'Team Dashboard'}
            </h1>
            <p className="text-[10px] text-slate-400">{today}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center bg-slate-100 rounded-lg p-1 border border-slate-200">
            <button
              onClick={() => setViewMode('mine')}
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                viewMode === 'mine' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              My Tasks
            </button>
            <button
              onClick={() => setViewMode('all')}
              className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${
                viewMode === 'all' ? 'bg-white shadow-sm text-primary' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Overall Team
            </button>
          </div>
          <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold text-slate-500 hover:bg-slate-100 uppercase tracking-widest transition-all disabled:opacity-40"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto thin-scrollbar p-5">
        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-[11px] text-red-600 font-medium">
            Failed to load dashboard: {error}
          </div>
        )}

        {loading && !data && (
          <div className="flex items-center justify-center h-64">
            <div className="flex items-center gap-2 text-slate-400">
              <div className="w-4 h-4 border-2 border-slate-300 border-t-primary rounded-full animate-spin" />
              <span className="text-[11px] font-medium">Loading dashboard…</span>
            </div>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {/* Row 1: Today's Focus + Critical */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PanelCard title={`Today's Focus (${data.todayFocus.length})`}>
                <TodayFocusPanel tasks={data.todayFocus} />
              </PanelCard>
              <PanelCard
                title={`Critical: ${data.critical.overdue.length} overdue · ${data.critical.approachingDeadline.length} due soon`}
              >
                <CriticalPanel
                  overdue={data.critical.overdue}
                  approachingDeadline={data.critical.approachingDeadline}
                />
              </PanelCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PanelCard title="Man-Hours Monitor — Budget · Allotted · Logged">
                <ManHoursPanel />
              </PanelCard>
              <PanelCard title="Kanban Board Status">
                <KanbanStatusPanel />
              </PanelCard>
            </div>

            {/* Row 4: Workload Heatmap (full width) */}
            <PanelCard title="Workload Heatmap — 14-day rolling">
              <WorkloadHeatmap data={data.workloadHeatmap} />
            </PanelCard>

            {/* Row 5: Project Health + Recurring Maintenance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PanelCard title={`Project Health (${data.projectHealth.length} active)`}>
                <ProjectHealthGrid projects={data.projectHealth} />
              </PanelCard>
              <PanelCard title={`Recurring Maintenance (${data.recurringMaintenance.length} today)`}>
                <RecurringMaintenancePanel tasks={data.recurringMaintenance} onRefresh={refresh} />
              </PanelCard>
            </div>

            {/* Row 4: AI Day Planner + Activity Feed */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <PanelCard title="AI Day Planner">
                <AiDayPlannerPanel />
              </PanelCard>
              <PanelCard title={`Activity Feed (${data.recentActivity.length})`}>
                <ActivityFeedPanel entries={data.recentActivity} />
              </PanelCard>
            </div>

            {/* Row 5: Quick Add */}
            <QuickAddTask onAdded={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
