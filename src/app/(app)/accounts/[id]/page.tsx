"use client";

import React, { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useBreadcrumbs } from "@/lib/contexts/BreadcrumbContext";
import { AccountHub } from "@/app/(app)/meeting-prep/page";
import AccountAccessControl from "@/components/accounts/AccountAccessControl";

export default function AccountDetailPage() {
  const params = useParams();
  const router = useRouter();
  const accountId = params.id as string;

  const [profile, setProfile] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  // STABILITY: Integrated Central Navigation
  useBreadcrumbs([
    { label: "Accounts", href: "/accounts" },
    { label: loading ? "Loading..." : (profile ? profile.companyName : "Not Found") }
  ]);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch(`/api/accounts/${accountId}`);
        if (res.ok) {
          const data = await res.json();
          setProfile(data);
        } else {
          console.error("Account not found");
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    if (accountId) loadProfile();
  }, [accountId]);

  if (loading) {
    return (
      <div className="flex flex-col h-screen bg-surface-subtle">
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex flex-col h-screen bg-surface-subtle">
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <p className="text-text-secondary">Account not found.</p>
          <button 
            onClick={() => router.push("/accounts")}
            className="px-4 py-2 bg-primary text-white rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Back to Accounts
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex flex-col h-screen bg-surface-subtle">
        <div className="flex-1 overflow-auto flex flex-col">
          {/* Admin Access Control card sits at the top so it's always visible.
              The component returns null for non-admins. */}
          <div className="px-6 pt-6 pb-2 max-w-4xl mx-auto w-full">
            <AccountAccessControl accountId={accountId} companyName={profile.companyName} />
          </div>
          <div className="flex-1 min-h-0">
            <AccountHub
              profile={profile}
              onEdit={() => router.push(`/accounts`)}
              onBack={() => router.push("/accounts")}
            />
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
