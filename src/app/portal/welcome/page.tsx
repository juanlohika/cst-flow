"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Heart, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function WelcomePage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <WelcomeInner />
    </Suspense>
  );
}

function LoadingCard() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
    </div>
  );
}

function WelcomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"validating" | "success" | "error">("validating");
  const [error, setError] = useState<string>("");
  const [sessionInfo, setSessionInfo] = useState<{ contactName: string; clientName: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("No invite token in this link. Please use the link from your email exactly as it was sent.");
      return;
    }

    async function validate() {
      try {
        const res = await fetch("/api/portal/auth/magic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setError(data.error || "Could not validate the invite link.");
          return;
        }
        setSessionInfo({
          contactName: data.session.contactName,
          clientName: data.session.clientName,
        });
        setStatus("success");
        // Redirect after a brief celebration
        setTimeout(() => router.push("/portal"), 1500);
      } catch (err: any) {
        setStatus("error");
        setError(err.message || "Network error. Please try again.");
      }
    }
    validate();
  }, [token, router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl shadow-rose-500/10 border border-slate-100 p-8 max-w-md w-full text-center">
        {status === "validating" && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center shadow-lg shadow-rose-500/30 mb-4">
              <Loader2 className="w-7 h-7 text-white animate-spin" />
            </div>
            <h1 className="text-lg font-black text-slate-800 mb-1">Activating your access…</h1>
            <p className="text-[12px] text-slate-500">Just a second.</p>
          </>
        )}

        {status === "success" && sessionInfo && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 mb-4">
              <CheckCircle2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-lg font-black text-slate-800 mb-1">
              Welcome, {sessionInfo.contactName.split(" ")[0]}!
            </h1>
            <p className="text-[13px] text-slate-500 mb-4">
              You're now connected to ARIMA for <strong className="text-slate-700">{sessionInfo.clientName}</strong>.
            </p>
            <p className="text-[11px] text-slate-400">Redirecting…</p>
          </>
        )}

        {status === "error" && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30 mb-4">
              <AlertTriangle className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-lg font-black text-slate-800 mb-1">Couldn't open ARIMA</h1>
            <p className="text-[13px] text-slate-500 mb-4">{error}</p>
            <p className="text-[11px] text-slate-400">
              If this keeps happening, contact your account team and ask for a fresh invite link.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
