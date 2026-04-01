"use client";

import { useState, useEffect, useCallback } from "react";

export interface DashboardData {
  todayFocus: any[];
  critical: {
    overdue: any[];
    approachingDeadline: any[];
  };
  workloadHeatmap: {
    date: string;
    plannedHours: number;
    capacity: number;
    level: "ok" | "warning" | "critical";
    byOwner: any[];
  }[];
  projectHealth: {
    projectId: string;
    name: string;
    companyName: string;
    percentComplete: number;
    daysToDeadline: number | null;
    overdueCount: number;
    totalTasks: number;
  }[];
  recurringMaintenance: any[];
  recentActivity: any[];
}

export function useDashboard(filterType: 'mine' | 'all' = 'mine') {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard?filter=${filterType}`);
      if (!res.ok) throw new Error("Failed to load dashboard");
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterType]);

  useEffect(() => { refresh(); }, [refresh]);

  return { data, loading, error, refresh };
}
