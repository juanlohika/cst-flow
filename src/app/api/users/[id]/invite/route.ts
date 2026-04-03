import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { sendInviteEmail } from "@/lib/email";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 
 * POST /api/users/[id]/invite — (re)send invite email 
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    const currentUserRole = (session?.user as any)?.role;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (currentUserRole !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = params;

    const rows = await db.select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      status: usersTable.status
    })
    .from(usersTable)
    .where(eq(usersTable.id, targetUserId))
    .limit(1);

    if (rows.length === 0) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const user = rows[0];
    // If user is already active/approved, we don't need to re-invite (though they might want to reset)
    // For this flow, we follow the original logic: only re-invite if status is 'pending' or similar
    if (user.status === "active") {
      return NextResponse.json({ error: "User is already active" }, { status: 400 });
    }

    // Regenerate invite token
    const inviteToken = randomBytes(32).toString("hex");
    const now = new Date().toISOString();

    await db.update(usersTable)
      .set({
        inviteToken,
        invitedBy: currentUserId,
        invitedAt: now
      })
      .where(eq(usersTable.id, targetUserId));

    const inviterName = session?.user?.name || session?.user?.email || "A team admin";
    await sendInviteEmail({
      to: user.email!,
      inviteeName: user.name || "",
      invitedByName: inviterName,
      inviteToken,
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("POST /api/users/[id]/invite error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
