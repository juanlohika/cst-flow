import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { projects, projectStakeholders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { sendPortalInviteEmail } from "@/lib/email";

/**
 * POST /api/projects/[id]/stakeholders/invite
 * Body: { stakeholderId }
 * Sends the portal invite email to the stakeholder.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  let stakeholderId: string | undefined;
  try {
    const session = await auth();
    if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

    const body = await req.json();
    stakeholderId = body.stakeholderId;
    if (!stakeholderId) return new NextResponse("stakeholderId required", { status: 400 });

    // Load the project (need shareToken + name)
    const [project] = await db.select().from(projects).where(eq(projects.id, params.id)).limit(1);
    if (!project) return new NextResponse("Project not found", { status: 404 });
    if (!project.shareToken) return new NextResponse("Project has no share token", { status: 400 });

    // Load the stakeholder
    const [stakeholder] = await db
      .select()
      .from(projectStakeholders)
      .where(and(eq(projectStakeholders.id, stakeholderId), eq(projectStakeholders.projectId, params.id)))
      .limit(1);

    if (!stakeholder) return new NextResponse("Stakeholder not found", { status: 404 });
    if (!stakeholder.email) return new NextResponse("Stakeholder has no email address", { status: 400 });

    await sendPortalInviteEmail({
      to: stakeholder.email,
      stakeholderName: stakeholder.fullName,
      projectName: project.name || "Project",
      senderName: session.user.name || session.user.email || "Your project team",
      shareToken: project.shareToken,
    });

    // Mark stakeholder as having portal access
    await db
      .update(projectStakeholders)
      .set({ hasPortalAccess: true })
      .where(eq(projectStakeholders.id, stakeholderId));

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("[stakeholders/invite] Error Details:", {
        message: error.message,
        code: error.code,
        stack: error.stack,
        stakeholderId: stakeholderId,
        projectId: params.id
    });
    return new NextResponse(error.message || "Failed to send invite", { status: 500 });
  }
}
