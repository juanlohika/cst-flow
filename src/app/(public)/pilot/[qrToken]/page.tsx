/**
 * Pilot Tracker — public participant portal.
 *
 * URL: /pilot/[qrToken]
 *
 * Two phases:
 *   1. Identity match — participant types Emp ID / name / mobile,
 *      picks their record from up to 5 masked matches.
 *   2. Personal onboarding checklist — Screens B–F from the spec, plus a
 *      persistent status summary card.
 *
 * No login. QR token is the only entry gate. Participant ID is persisted
 * in localStorage under a QR-scoped key so a returning visitor from the
 * same phone doesn't have to re-identify.
 */
import { PilotPortalClient } from "@/components/pilot-tracker/PilotPortalClient";
import { headers } from "next/headers";

interface Params {
  params: Promise<{ qrToken: string }>;
}

export default async function PilotPortalPage({ params }: Params) {
  const { qrToken } = await params;
  // Fetch project metadata server-side so the page renders with the
  // company name / target version already known — participant doesn't
  // see a flash of "loading" chrome.
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  const proto = h.get("x-forwarded-proto") || "https";
  const origin = host ? `${proto}://${host}` : "";

  let project: any = null;
  let error: string | null = null;
  let branding: { appName: string; logoUrl: string } = { appName: "CST OS", logoUrl: "" };
  try {
    const [projectRes, brandingRes] = await Promise.all([
      fetch(`${origin}/api/pilot/${qrToken}`, { cache: "no-store" }),
      fetch(`${origin}/api/branding`, { cache: "no-store" }),
    ]);
    const projectJson = await projectRes.json();
    if (!projectRes.ok) {
      error = projectJson.error || `Pilot not found (${projectRes.status})`;
    } else {
      project = projectJson.project;
    }
    if (brandingRes.ok) {
      const b = await brandingRes.json();
      branding = { appName: b.appName || "CST OS", logoUrl: b.logoUrl || "" };
    }
  } catch (e: any) {
    error = e?.message || "Failed to load pilot";
  }

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center">
          <h1 className="text-lg font-semibold text-gray-900 mb-2">
            Pilot not available
          </h1>
          <p className="text-sm text-gray-600 mb-4">{error}</p>
          <p className="text-xs text-gray-500">
            If you were given a QR code by your CST rep, please rescan it or
            contact them directly.
          </p>
        </div>
      </main>
    );
  }

  return <PilotPortalClient qrToken={qrToken} project={project} branding={branding} />;
}
