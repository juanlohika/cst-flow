import { Clock } from "lucide-react";

export const metadata = { title: "ARIMA — Session ended" };

export default function ExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl shadow-rose-500/10 border border-slate-100 p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-slate-300 to-slate-400 flex items-center justify-center shadow-lg mb-4">
          <Clock className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-lg font-black text-slate-800 mb-2">Your session has ended</h1>
        <p className="text-[13px] text-slate-500 mb-1">
          For security, you've been signed out of ARIMA.
        </p>
        <p className="text-[13px] text-slate-500">
          To get back in, please open the most recent invite email from your CST account team and click the link inside. If you don't have one, contact your account manager and they'll send you a fresh one.
        </p>
      </div>
    </div>
  );
}
