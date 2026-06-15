/**
 * /pin-validator/error?title=&reason=&code=
 *
 * Friendly error card shown when a magic link can't be redeemed. Pure
 * read-only Server Component — does not touch cookies or the DB, so it
 * can't trip the "Server Components render" error that bit the original
 * welcome page when it tried to set a cookie outside a Route Handler.
 */
import { MapPin } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ title?: string; reason?: string; code?: string }>;
}

export default async function PinValidatorErrorPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const title = sp.title?.trim() || "Link unavailable";
  const reason = sp.reason?.trim() || "This link can't be used right now.";

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
        <div className="flex justify-center mb-3">
          <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <MapPin className="w-6 h-6" />
          </div>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-600 mb-6">{reason}</p>
        <p className="text-xs text-slate-400">
          Ask your CST contact to send you a fresh link.
        </p>
      </div>
    </div>
  );
}
