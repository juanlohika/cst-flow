/**
 * /pin-validator/welcome?token=... — landing page for magic-link clicks.
 *
 * Server component: validates the token, sets the session cookie, then
 * server-redirects to the validator UI. Friendly error messages for
 * already-used / expired / invalid links.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { MapPin } from "lucide-react";
import {
  consumePinValidatorMagicLink,
  setPinValidatorSessionCookie,
} from "@/lib/pin-validator/session";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function PinValidatorWelcomePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const token = sp?.token?.trim();
  if (!token) {
    return <Failure title="Missing link" body="No token provided." />;
  }

  const h = await headers();
  const userAgent = h.get("user-agent") || undefined;
  const ipAddress =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    undefined;

  const result = await consumePinValidatorMagicLink(token, {
    userAgent,
    ipAddress,
  });

  if (!result.ok) {
    return (
      <Failure
        title={
          result.code === "already_used"
            ? "Link already used"
            : result.code === "expired"
            ? "Link expired"
            : "Link invalid"
        }
        body={result.reason}
      />
    );
  }

  await setPinValidatorSessionCookie(result.sessionId);
  redirect(`/pin-validator/${result.session.projectId}`);
}

function Failure({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
        <div className="flex justify-center mb-3">
          <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <MapPin className="w-6 h-6" />
          </div>
        </div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">{title}</h1>
        <p className="text-sm text-slate-600 mb-6">{body}</p>
        <p className="text-xs text-slate-400">
          Ask your CST contact to send you a fresh link.
        </p>
      </div>
    </div>
  );
}
