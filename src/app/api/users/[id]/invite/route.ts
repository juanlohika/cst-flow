import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/* ─── POST /api/users/[id]/invite ─── (re)send invite email ─── */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, email, status FROM User WHERE id = ?`, params.id
  );
  if (!users.length) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const user = users[0];
  if (user.status === "approved") {
    return NextResponse.json({ error: "User is already active" }, { status: 400 });
  }

  // Regenerate invite token
  const inviteToken = randomBytes(32).toString("hex");
  const now = new Date().toISOString();

  await prisma.$executeRawUnsafe(
    `UPDATE User SET inviteToken = ?, invitedBy = ?, invitedAt = ? WHERE id = ?`,
    inviteToken, session.user.id, now, params.id
  );

  const inviterName = session.user.name || session.user.email || "A team admin";
  await sendInviteEmail({
    to: user.email,
    inviteeName: user.name || "",
    invitedByName: inviterName,
    inviteToken,
  });

  return NextResponse.json({ success: true });
}
