"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, AlertTriangle, CheckCircle2, Mail, ArrowRight, Send } from "lucide-react";

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
      <Loader2 className="w-6 h-6 animate-spin text-[#0177b5]" />
    </div>
  );
}

function WelcomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<"validating" | "success" | "error">("validating");
  const [error, setError] = useState<string>("");
  const [errorCode, setErrorCode] = useState<string>("");
  const [contactEmail, setContactEmail] = useState<string>("");
  const [resendEmail, setResendEmail] = useState<string>("");
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ contactName: string; clientName: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("No invite token in this link. Please use the link from your email exactly as it was sent.");
      setErrorCode("invalid");
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
          setErrorCode(data.errorCode || "invalid");
          if (data.contactEmail) {
            setContactEmail(data.contactEmail);
            setResendEmail(data.contactEmail);
          }
          return;
        }
        // alreadySignedIn → server reused our existing session cookie. Just go in.
        setSessionInfo({
          contactName: data.session.contactName,
          clientName: data.session.clientName,
        });
        setStatus("success");
        setTimeout(() => router.push("/portal"), data.alreadySignedIn ? 600 : 1500);
      } catch (err: any) {
        setStatus("error");
        setError(err.message || "Network error. Please try again.");
        setErrorCode("invalid");
      }
    }
    validate();
  }, [token, router]);

  const sendResend = async () => {
    const target = resendEmail.trim();
    if (!target || resending) return;
    setResending(true);
    try {
      await fetch("/api/portal/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
    } finally {
      setResending(false);
      setResent(true);
    }
  };

  const canResend = errorCode === "already_used" || errorCode === "expired";

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl shadow-[#0177b5]/10 border border-slate-100 p-8 max-w-md w-full text-center">
        {status === "validating" && (
          <>
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[#0177b5] to-[#015a9c] flex items-center justify-center shadow-lg shadow-[#0177b5]/30 mb-4">
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
              <AlertTriangle className="w-7 h-7 text-white" strokeWidth={1.8} />
            </div>
            <h1 className="text-lg font-black text-slate-800 mb-1">
              {canResend ? "Link already used" : "Couldn't open ARIMA"}
            </h1>
            <p className="text-[13px] text-slate-500 mb-4">{error}</p>

            {canResend && !resent && (
              <div className="space-y-2 text-left">
                <p className="text-[11px] text-slate-500 px-1">
                  We'll email you a fresh one-time link.
                  {contactEmail && (
                    <> Sending to <strong className="text-slate-700">{contactEmail}</strong>.</>
                  )}
                </p>
                {!contactEmail && (
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      value={resendEmail}
                      onChange={e => setResendEmail(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") sendResend(); }}
                      placeholder="you@company.com"
                      autoFocus
                      disabled={resending}
                      className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[14px] text-slate-700 placeholder:text-slate-300 outline-none focus:border-[#0177b5]/40 focus:bg-white"
                    />
                  </div>
                )}
                <button
                  onClick={sendResend}
                  disabled={(!contactEmail && !resendEmail.trim()) || resending}
                  className={`w-full py-3 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all ${
                    (contactEmail || resendEmail.trim()) && !resending
                      ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white shadow-md shadow-[#0177b5]/30 hover:shadow-lg"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send me a new link
                  {!resending && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            )}

            {canResend && resent && (
              <div className="bg-[#F0F4FC] border border-[#0177b5]/15 rounded-2xl p-4 flex items-start gap-3 text-left">
                <div className="w-7 h-7 rounded-xl bg-[#0177b5]/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-[#0177b5]" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-black text-slate-800 mb-1">Check your inbox</p>
                  <p className="text-[12px] text-slate-600 leading-relaxed">
                    A fresh link is on its way to <strong className="text-slate-700">{contactEmail || resendEmail}</strong>. Click it from this device to stay signed in for 6 months.
                  </p>
                </div>
              </div>
            )}

            {!canResend && (
              <p className="text-[11px] text-slate-400">
                If this keeps happening, contact your account team and ask for a fresh invite link.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
