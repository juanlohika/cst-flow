"use client";

import React, { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";

export default function ProjectRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  useEffect(() => {
    async function findParentAccount() {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.clientProfileId) {
            router.replace(`/accounts/${data.clientProfileId}?activeTab=projects&projectId=${projectId}`);
          } else {
             // Fallback if no account link
             router.replace(`/accounts`);
          }
        } else {
           console.error("Project not found");
           router.replace(`/accounts`);
        }
      } catch (err) {
        console.error(err);
        router.replace(`/accounts`);
      }
    }
    if (projectId) findParentAccount();
  }, [projectId, router]);

  return (
    <AuthGuard>
      <div className="flex h-screen items-center justify-center bg-surface-subtle">
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-[11px] text-text-muted">Redirecting to project host account...</p>
        </div>
      </div>
    </AuthGuard>
  );
}
