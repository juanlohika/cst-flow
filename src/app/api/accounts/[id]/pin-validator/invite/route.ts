/**
 * POST /api/accounts/[id]/pin-validator/invite
 *
 * Body: { email: string, name?: string, role?: string }
 *
 * Workflow:
 *   1. Ensure a ClientContact with pinValidatorEnabled=true exists for this
 *      account+email.
 *   2. Create a fresh magic link scoped to (contact × project × purpose).
 *   3. Send the invite email via SMTP. If SMTP isn't configured, still
 *      return the link so the user can share it manually.
 *
 * Auth: signed-in CST OS user with access to the account.
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { pinValidatorProjects, users as usersTable } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { canAccessClient, ensureAccessSchema } from "@/lib/access/accounts";
import {
  ensureValidatorContact,
  createPinValidatorMagicLink,
  sendPinValidatorInviteEmail,
  loadProjectContext,
} from "@/lib/pin-validator/invite";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const actor = {
    userId: session.user.id as string,
    isAdmin: (session.user as any).role === "admin",
  };
  await ensureAccessSchema();
  if (!(await canAccessClient(actor, id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = String(body?.email ?? "").trim().toLowerCase();
  const name = body?.name ? String(body.name).trim() : undefined;
  const role = body?.role ? String(body.role).trim() : undefined;
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ error: "Provide a valid email." }, { status: 400 });
  }

  try {
    const projectRows = await db
      .select({ id: pinValidatorProjects.id, name: pinValidatorProjects.name })
      .from(pinValidatorProjects)
      .where(
        and(
          eq(pinValidatorProjects.clientProfileId, id),
          eq(pinValidatorProjects.status, "active"),
        ),
      )
      .limit(1);
    if (projectRows.length === 0) {
      return NextResponse.json(
        { error: "Pin Validator is not activated for this account." },
        { status: 404 },
      );
    }
    const projectId = projectRows[0].id;

    const { contactId, isNew } = await ensureValidatorContact({
      clientProfileId: id,
      email,
      name,
      role,
      invitedByUserId: actor.userId,
    });

    const link = await createPinValidatorMagicLink({
      contactId,
      contactEmail: email,
      projectId,
      createdByUserId: actor.userId,
    });

    // Lookup inviter's display name from the users table for the email body.
    let inviterName = "Your CST team";
    try {
      const u = await db
        .select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, actor.userId))
        .limit(1);
      if (u.length > 0) {
        inviterName = u[0].name || u[0].email || inviterName;
      }
    } catch {
      /* non-fatal — fall back to "Your CST team" */
    }

    const projectCtx = await loadProjectContext(projectId);
    const accountName = projectCtx?.accountName || "your account";

    const sent = await sendPinValidatorInviteEmail({
      to: email,
      validatorName: name || email.split("@")[0],
      inviterName,
      accountName,
      inviteUrl: link.url,
    });

    return NextResponse.json({
      ok: true,
      contactId,
      contactIsNew: isNew,
      inviteUrl: link.url,
      expiresAt: link.expiresAt,
      emailSent: sent.sent,
      emailError: sent.sent ? undefined : sent.reason,
    });
  } catch (e: any) {
    console.error("[pin-validator/invite] failed:", e);
    return NextResponse.json(
      { error: e?.message || "Failed to send invite" },
      { status: 500 },
    );
  }
}
