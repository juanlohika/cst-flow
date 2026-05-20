import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { proposals, proposalSettings, clientProfiles, users as usersTable } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { ensureAccessSchema, canAccessClient } from "@/lib/access/accounts";
import { buildProposalContent } from "@/lib/proposal/build-content";
import type { ProposalUserInputs } from "@/lib/proposal/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/proposal-maker/create
 * Body: ProposalUserInputs
 *
 * Runs the AI to produce ProposalContent, saves a new Proposal row, returns
 * { id, content }. The PDF is generated on demand via export-pdf later.
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccessSchema();
    const isAdmin = (session.user as any).role === "admin";

    const inputs = (await req.json().catch(() => ({}))) as ProposalUserInputs;
    if (!inputs?.clientProfileId) return NextResponse.json({ error: "clientProfileId required" }, { status: 400 });
    if (!inputs?.title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });
    if (!inputs?.scopeNotes?.trim()) return NextResponse.json({ error: "scopeNotes required" }, { status: 400 });
    if (!inputs?.totalCost?.trim()) return NextResponse.json({ error: "totalCost required — cost must be human-confirmed" }, { status: 400 });

    // Access gate — non-admins must have membership for this client
    const allowed = await canAccessClient({ userId: session.user.id, isAdmin }, inputs.clientProfileId);
    if (!allowed) return NextResponse.json({ error: "You don't have access to this account" }, { status: 403 });

    // Look up client + preparer for AI prompt
    const clientRows = await db.select({ companyName: clientProfiles.companyName }).from(clientProfiles).where(eq(clientProfiles.id, inputs.clientProfileId)).limit(1);
    const clientCompanyName = clientRows[0]?.companyName;
    if (!clientCompanyName) return NextResponse.json({ error: "Account not found" }, { status: 404 });

    const preparerRows = await db.select({ name: usersTable.name, email: usersTable.email }).from(usersTable).where(eq(usersTable.id, session.user.id)).limit(1);
    const preparedByName = preparerRows[0]?.name || preparerRows[0]?.email || "Tarkie team";

    // Determine next version number for this account
    const prior = await db.select({ versionNumber: proposals.versionNumber })
      .from(proposals)
      .where(eq(proposals.clientProfileId, inputs.clientProfileId))
      .orderBy(desc(proposals.versionNumber))
      .limit(1);
    const versionNumber = (prior[0]?.versionNumber || 0) + 1;

    // Generate via AI
    const built = await buildProposalContent({ inputs, clientCompanyName, preparedByName });
    if (!built.ok) return NextResponse.json({ error: built.error, rawAi: (built as any).rawAi }, { status: 500 });

    // Stamp the actual version number on the content (AI may have guessed)
    built.content.version.number = versionNumber;

    const proposalId = `prop_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(proposals).values({
      id: proposalId,
      clientProfileId: inputs.clientProfileId,
      title: built.content.title,
      versionNumber,
      sourceInputs: JSON.stringify(built.content),
      status: "draft",
      generatedBy: session.user.id,
    });

    return NextResponse.json({ id: proposalId, content: built.content });
  } catch (error: any) {
    console.error("[proposal-maker/create POST]", error);
    return NextResponse.json({ error: error.message || "Failed" }, { status: 500 });
  }
}
