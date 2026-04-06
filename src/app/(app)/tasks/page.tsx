"use client";

import React, { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import TaskDashboard from "@/components/tasks/TaskDashboard";
import PersonalDashboard from "@/components/tasks/PersonalDashboard";
import ArchivedProjectList from "@/components/projects/ArchivedProjectList";

function TasksContent() {
  const searchParams = useSearchParams();
  const projectParam = searchParams.get("project");
  const [projectName, setProjectName] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);

  // My Dashboard: specifically no project param
  const isMyDashboard = !projectParam;
  // All Projects or Specific Project
  const isTaskView = !!projectParam;
  const projectId = projectParam || "ALL";

  // STABILITY: Integrated Central Navigation
  useBreadcrumbs([
    { label: "Tasks", href: "/tasks" },
    { label: isMyDashboard ? "My Dashboard" : (projectId === "ALL" ? "All Projects" : (projectName || "Project")) }
  ]);

  useEffect(() => {
    if (projectId !== "ALL") {
      fetch("/api/projects")
        .then(r => r.json())
        .then(data => {
          const list = Array.isArray(data) ? data : (data?.projects || []);
          const found = list.find((p: any) => p.id === projectId);
          setProjectName(found?.name ?? null);
          
          if (found?.clientProfileId) {
             fetch(`/api/profiles/${found.clientProfileId}`)
               .then(res => res.ok ? res.json() : null)
               .then(pData => setProfile(pData))
               .catch(() => {});
          }
        })
        .catch(() => {});
    } else {
      setProjectName(null);
      setProfile(null);
    }
  }, [projectId]);

  if (isMyDashboard) {
    return <PersonalDashboard />;
  }

  if (projectId === "ARCHIVE") {
    return <ArchivedProjectList />;
  }

  return <TaskDashboard projectId={projectId} projectName={projectName} profile={profile} />;
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex flex-col h-screen bg-white" />}>
      <TasksContent />
    </Suspense>
  );
}
