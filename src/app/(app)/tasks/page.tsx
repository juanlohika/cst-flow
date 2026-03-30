"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import TaskDashboard from "@/components/tasks/TaskDashboard";
import PersonalDashboard from "@/components/tasks/PersonalDashboard";

function TasksContent() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const [projectName, setProjectName] = useState<string | null>(null);

  // No project param → show Personal Dashboard
  const showPersonalDashboard = !projectParam;
  const projectId = projectParam || "ALL";

  // STABILITY: Integrated Central Navigation
  useBreadcrumbs([
    { label: "Tasks", href: "/tasks" },
    { label: showPersonalDashboard ? "My Dashboard" : (projectName || "All Projects") }
  ]);

  useEffect(() => {
    if (projectId !== "ALL") {
      fetch("/api/projects")
        .then(r => r.json())
        .then(data => {
          if (Array.isArray(data)) {
            const found = data.find((p: any) => p.id === projectId);
            setProjectName(found?.name ?? null);
          }
        })
        .catch(() => {});
    } else {
      setProjectName(null);
    }
  }, [projectId]);

  if (showPersonalDashboard) {
    return (
      <div className="flex flex-col h-screen overflow-hidden bg-white">
        <div className="flex-1 overflow-hidden flex flex-col">
          <PersonalDashboard />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-white">
      <div className="flex-1 overflow-hidden">
        <TaskDashboard projectId={projectId} />
      </div>
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen bg-white" />}>
      <TasksContent />
    </Suspense>
  );
}
