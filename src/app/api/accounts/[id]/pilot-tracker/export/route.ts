/**
 * Pilot Tracker — CSV export.
 *
 * GET /api/accounts/[id]/pilot-tracker/export
 *   ?mode=devEmails | roster
 *   ?flag=AWAITING_REGISTRATION|... (optional filter)
 *
 * Modes:
 *   devEmails — one-column CSV of Play Store emails needing tester-list
 *               registration. Filters to AWAITING_REGISTRATION +
 *               CLICKED_NOT_REGISTERED by default. This is the file dev
 *               copy-pastes into the Play Console tester list.
 *   roster    — full multi-column export for audit + record-keeping.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pilotParticipants, pilotProjects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureAccessSchema();
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const [project] = await db
    .select({ id: pilotProjects.id, name: pilotProjects.name })
    .from(pilotProjects)
    .where(and(eq(pilotProjects.clientProfileId, id), eq(pilotProjects.status, "active")))
    .limit(1);
  if (!project) {
    return NextResponse.json({ error: "No active pilot project" }, { status: 404 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "roster";

  if (mode === "devEmails") {
    // Emails needing to be added to the Play tester list.
    const rows = await db
      .select({
        email: pilotParticipants.playstoreEmail,
        employeeId: pilotParticipants.employeeId,
        fullName: pilotParticipants.fullName,
        issueFlag: pilotParticipants.issueFlag,
      })
      .from(pilotParticipants)
      .where(
        and(
          eq(pilotParticipants.projectId, project.id),
          inArray(pilotParticipants.issueFlag, [
            "AWAITING_REGISTRATION",
            "CLICKED_NOT_REGISTERED",
          ]),
        ),
      );
    const filtered = rows.filter((r) => r.email && r.email.includes("@"));
    // For Play Console: one email per line is enough. Extra columns help
    // the admin sanity-check who's on the list.
    const headers = ["email", "employeeId", "fullName", "issueFlag"];
    const body = [
      headers.join(","),
      ...filtered.map((r) =>
        [r.email, r.employeeId, csvEscape(r.fullName), r.issueFlag].join(","),
      ),
    ].join("\n");
    const filename = `pilot-dev-emails-${dateStamp()}.csv`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Full roster export
  const rows = await db
    .select()
    .from(pilotParticipants)
    .where(eq(pilotParticipants.projectId, project.id));
  const headers = [
    "employeeId",
    "fullName",
    "mobileNumber",
    "mobileNumberCorrected",
    "playstoreEmail",
    "betaRegistered",
    "invitationAcceptedDeclared",
    "invitationLinkFailed",
    "appUpdatedDeclared",
    "mobileConfirmed",
    "reportedVersion",
    "versionVerified",
    "versionVerifiedByAi",
    "versionAiExtractedText",
    "currentStage",
    "issueFlag",
    "lastActivityAt",
    "lastActivityBy",
    "createdAt",
  ];
  const body = [
    headers.join(","),
    ...rows.map((r: any) =>
      headers.map((h) => csvEscape(r[h])).join(","),
    ),
  ].join("\n");
  const filename = `pilot-roster-${dateStamp()}.csv`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
