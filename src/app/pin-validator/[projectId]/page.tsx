/**
 * /pin-validator/[projectId] — the validator's home after redeeming their
 * magic link. Server-checks the session before mounting the map.
 *
 * If the cookie is missing or the session doesn't match this projectId, we
 * show a friendly "ask for a new link" screen rather than letting the API
 * 401 inside the map.
 */
import Link from "next/link";
import { getPinValidatorSession } from "@/lib/pin-validator/session";
import { MapValidator } from "@/components/pin-validator/MapValidator";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function PinValidatorViewerPage({ params }: PageProps) {
  const { projectId } = await params;
  const session = await getPinValidatorSession();
  if (!session) {
    return <SessionMissing reason="Your validator session has expired or is invalid." />;
  }
  if (session.projectId !== projectId) {
    return (
      <SessionMissing reason="This link does not match your current session. Ask for a fresh link." />
    );
  }
  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs">
        <span className="font-semibold text-slate-900">{session.clientName}</span>
        <span className="text-slate-400">· {session.projectName}</span>
        <span className="ml-auto text-slate-400">
          🔐 {session.contactName} ({session.contactEmail})
        </span>
      </header>
      <main className="flex-1 overflow-hidden">
        <MapValidator
          projectId={projectId}
          validatorLabel={session.contactEmail}
        />
      </main>
    </div>
  );
}

function SessionMissing({ reason }: { reason: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
        <div className="text-4xl mb-3">📍</div>
        <h1 className="text-lg font-semibold text-slate-900 mb-2">Session needed</h1>
        <p className="text-sm text-slate-600 mb-6">{reason}</p>
        <p className="text-xs text-slate-400">
          Ask your CST contact to send you a fresh validator link.
        </p>
      </div>
    </div>
  );
}
