import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { sendInviteEmail } from "@/lib/email";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

/* ─── GET /api/users ─── list all users (admin only) ─── */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = (session.user as any).role;
    if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // SAFE SELECT: Use * and handle potential missing columns in schema
    const users = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM User ORDER BY name ASC`
    );

    // Provide safety fallbacks for columns that might be missing in Turso
    const sanitizedUsers = users.map(u => ({
      ...u,
      role: u.role || 'user',
      status: u.status || 'approved',
      canAccessArchitect: u.canAccessArchitect ?? 0,
      canAccessBRD: u.canAccessBRD ?? 0,
      canAccessTimeline: u.canAccessTimeline ?? 0,
      canAccessTasks: u.canAccessTasks ?? 1,
      canAccessCalendar: u.canAccessCalendar ?? 1,
      canAccessMeetings: u.canAccessMeetings ?? 0,
      canAccessAccounts: u.canAccessAccounts ?? 0,
      canAccessSolutions: u.canAccessSolutions ?? 0,
    }));

    return NextResponse.json(sanitizedUsers);
  } catch (error: any) {
    console.error("GET /api/users error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/* ─── POST /api/users ─── create & invite user (admin only) ─── */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = (session.user as any).role;
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, email, sendEmail = true } = body;

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  // Check for existing user
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM User WHERE email = ?`, email.toLowerCase().trim()
  );
  if (existing.length > 0) {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
  }

  const id = `usr_${randomBytes(8).toString("hex")}`;
  const inviteToken = randomBytes(32).toString("hex");
  const now = new Date().toISOString();

  await prisma.$executeRawUnsafe(
    `INSERT INTO User (id, name, email, role, status, isSuperAdmin,
      canAccessArchitect, canAccessBRD, canAccessTimeline,
      canAccessTasks, canAccessCalendar, canAccessMeetings, canAccessAccounts, canAccessSolutions,
      inviteToken, invitedBy, invitedAt)
     VALUES (?, ?, ?, 'user', 'pending', 0,
      0, 0, 0,
      1, 1, 0, 0, 0,
      ?, ?, ?)`,
    id,
    name || email.split("@")[0],
    email.toLowerCase().trim(),
    inviteToken,
    session.user.id,
    now
  );

  // Send invite email
  let emailSent = false;
  let emailError: string | null = null;
  if (sendEmail) {
    try {
      const inviterName = session.user.name || session.user.email || "A team admin";
      await sendInviteEmail({
        to: email,
        inviteeName: name || "",
        invitedByName: inviterName,
        inviteToken,
      });
      emailSent = true;
    } catch (e: any) {
      emailError = e.message;
    }
  }

  const user = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, name, email, role, status, inviteToken, invitedAt FROM User WHERE id = ?`, id
  );

  return NextResponse.json({ user: user[0], emailSent, emailError }, { status: 201 });
}
