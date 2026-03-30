"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { AlertCircle, RefreshCw, Home, ShieldCheck, XCircle, CheckCircle2 } from "lucide-react";

interface ConfigStatus {
  hasGoogleId: boolean;
  hasGoogleSecret: boolean;
  hasAuthSecret: boolean;
  hasAuthUrl: boolean;
  hasTrustHost: boolean;
  timestamp: string;
}

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error") || "Default";
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const errorMessages: Record<string, string> = {
    Configuration: "The server is missing a required configuration (check Google Client ID/Secret).",
    AccessDenied: "You do not have permission to access this application.",
    Verification: "The verification link has expired or has already been used.",
    Default: "An unexpected authentication error occurred.",
  };

  useEffect(() => {
    if (error === "Configuration") {
      setLoading(true);
      fetch("/api/auth/config")
        .then((res) => res.json())
        .then((data) => setStatus(data))
        .catch(() => setStatus(null))
        .finally(() => setLoading(false));
    }
  }, [error]);

  const StatusItem = ({ label, exists }: { label: string; exists: boolean }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm font-medium text-gray-600">{label}</span>
      {exists ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
      ) : (
        <XCircle className="w-4 h-4 text-rose-500" />
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 font-sans text-center">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <div className="w-16 h-16 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-rose-500" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Authentication Error</h1>
        <p className="text-gray-600 mb-8">{errorMessages[error] || errorMessages.Default}</p>

        {error === "Configuration" && (
          <div className="mb-8 text-left bg-gray-50 rounded-xl p-4 border border-gray-100">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
              <ShieldCheck className="w-3 h-3" /> Server Health Check
            </h3>
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="w-5 h-5 text-gray-300 animate-spin" />
              </div>
            ) : status ? (
              <div className="space-y-1">
                <StatusItem label="Google Client ID" exists={status.hasGoogleId} />
                <StatusItem label="Google Secret" exists={status.hasGoogleSecret} />
                <StatusItem label="Auth Secret (NextAuth)" exists={status.hasAuthSecret} />
                <StatusItem label="Base URL (AUTH_URL)" exists={status.hasAuthUrl} />
                <StatusItem label="Host Trust Flag" exists={status.hasTrustHost} />
              </div>
            ) : (
              <p className="text-xs text-rose-400 italic">Could not fetch server status. Check console.</p>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            onClick={() => window.location.href = "/auth/signin"}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-200"
          >
            <RefreshCw className="w-4 h-4" /> Try Again
          </button>
          <Link
            href="/"
            className="w-full py-3 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all text-center"
          >
            <Home className="w-4 h-4" /> Back to Home
          </Link>
        </div>

        <div className="mt-12 opacity-30 text-[10px] font-medium tracking-tight">
          CST FlowDesk Production Stability v6
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
