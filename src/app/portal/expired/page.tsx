"use client";

import { useState } from "react";
import { Clock, Mail, Loader2, CheckCircle2, ArrowRight } from "lucide-react";

export default function ExpiredPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const sendLink = async () => {
    const trimmed = email.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/portal/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl shadow-[#0177b5]/10 border border-slate-100 p-8 max-w-md w-full">
        <div className="text-center mb-5">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center shadow-lg mb-4">
            <Clock className="w-7 h-7 text-white" strokeWidth={1.8} />
          </div>
          <h1 className="text-lg font-black text-slate-800 mb-1.5">You've been signed out</h1>
          <p className="text-[13px] text-slate-500">
            Your session ended. Enter your email below and we'll send you a fresh link — your full conversation history will be there.
          </p>
        </div>

        {!sent ? (
          <div className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") sendLink(); }}
                placeholder="you@company.com"
                autoFocus
                disabled={submitting}
                className="w-full pl-10 pr-3 py-3 rounded-xl border border-slate-200 bg-slate-50 text-[14px] text-slate-700 placeholder:text-slate-300 outline-none focus:border-[#0177b5]/40 focus:bg-white transition-colors"
              />
            </div>
            <button
              onClick={sendLink}
              disabled={!email.trim() || submitting}
              className={`w-full py-3 rounded-xl font-bold text-[13px] flex items-center justify-center gap-2 transition-all ${
                email.trim() && !submitting
                  ? "bg-gradient-to-br from-[#0177b5] to-[#015a9c] text-white shadow-md shadow-[#0177b5]/30 hover:shadow-lg"
                  : "bg-slate-100 text-slate-400"
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Send me a new link
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest text-center pt-1">
              The link is one-time, expires in 7 days
            </p>
          </div>
        ) : (
          <div className="bg-[#F0F4FC] border border-[#0177b5]/15 rounded-2xl p-4 flex items-start gap-3">
            <div className="w-7 h-7 rounded-xl bg-[#0177b5]/15 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-[#0177b5]" />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-black text-slate-800 mb-1">Check your inbox</p>
              <p className="text-[12px] text-slate-600 leading-relaxed">
                If <strong className="text-slate-700">{email}</strong> is on file, you'll receive a fresh link shortly. Click it on this device to stay signed in for 6 months.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
