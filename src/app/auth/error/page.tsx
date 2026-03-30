"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, RefreshCcw, RefreshCw } from "lucide-react";
import { Suspense } from "react";

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    Configuration: "The server is missing a required configuration (check Google Client ID/Secret).",
    AccessDenied: "You do not have permission to access this resource.",
    Verification: "The verification token has expired or has already been used.",
    Default: "An unexpected error occurred during authentication.",
  };

  const message = errorMessages[error as string] || errorMessages.Default;

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="mb-6 rounded-full bg-destructive/10 p-4 text-destructive">
        <AlertCircle size={48} />
      </div>

      <h1 className="mb-2 text-3xl font-bold tracking-tight">Authentication Error</h1>
      <p className="mb-8 max-w-xs text-muted-foreground">
        {message}
        {error && <code className="block mt-2 text-xs opacity-50">Code: {error}</code>}
      </p>

      <div className="flex flex-col gap-3 w-full max-w-[280px]">
        <button
          onClick={() => window.location.href = "/auth/signin"}
          className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:opacity-90"
        >
          <RefreshCcw size={16} />
          Try Again
        </button>

        <Link
          href="/"
          className="flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-semibold transition-all hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft size={16} />
          Back to Home
        </Link>
      </div>

      <div className="mt-12 text-xs text-muted-foreground/50">
        CST FlowDesk Production Stability v4
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <RefreshCw className="animate-spin text-muted-foreground" size={24} />
      </div>
    }>
      <AuthErrorContent />
    </Suspense>
  );
}
