"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useState, Suspense } from "react";
import { LayoutGrid, ShieldCheck, AlertTriangle } from "lucide-react";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const error = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [credError, setCredError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredError("");
    setLoading(true);
    const result = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setCredError("Invalid credentials or access denied.");
    } else if (result?.url) {
      window.location.href = result.url;
    }
  };

  return (
    <div className="w-full max-w-md space-y-8 animate-in fade-in zoom-in duration-500">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center mb-6">
          <div className="w-16 h-16 bg-primary/10 rounded-3xl flex items-center justify-center text-primary shadow-xl shadow-primary/5">
            <LayoutGrid className="w-8 h-8" />
          </div>
        </div>
        <h1 className="text-3xl font-black uppercase tracking-tighter text-slate-900">Sign In</h1>
        <p className="text-xs font-black uppercase tracking-[0.3em] text-slate-400">CST FlowDesk · Secure Workspace</p>
      </div>

      {error === "domain" && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs font-bold text-red-600">
            Access denied. Only @mobileoptima.com, @tarkie.com, and @olern.ph accounts are allowed.
          </p>
        </div>
      )}

      {(error === "OAuthSignin" || error === "OAuthCallback" || error === "OAuthAccountNotLinked") && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-xs font-bold text-red-600">Sign-in failed. Please try again.</p>
        </div>
      )}

      <div className="bg-white p-8 rounded-[2rem] shadow-2xl shadow-slate-200/50 border border-slate-100 space-y-4">
        <button
          onClick={() => signIn("google", { callbackUrl })}
          className="w-full flex items-center justify-center gap-3 h-14 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all font-black text-[11px] uppercase tracking-widest text-slate-700"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4" />
          Sign in with Google
        </button>

        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
          <div className="relative flex justify-center text-[10px] uppercase font-black"><span className="bg-white px-4 text-slate-300 tracking-[0.3em]">or email</span></div>
        </div>

        <form onSubmit={handleCredentials} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full h-12 px-4 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full h-12 px-4 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-slate-50"
          />
          {credError && (
            <p className="text-[11px] font-bold text-red-500">{credError}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-12 rounded-xl bg-primary hover:bg-primary/90 text-white transition-all font-black text-[11px] uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            <ShieldCheck className="w-4 h-4" />
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </div>

      <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">
        Access restricted to authorized domains only
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-slate-50">
      <Suspense fallback={<div className="w-16 h-16 rounded-3xl bg-primary/10 animate-pulse" />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}
