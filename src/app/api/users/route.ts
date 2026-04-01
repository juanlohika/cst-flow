import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { sendInviteEmail } from "@/lib/email";
import { randomBytes } from "crypto";
import { eq, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 
 * GET /api/users — list all users (admin only) 
 * MIGRATED TO DRIZZLE
 */
export async function GET() {
  try {
    const session = await auth();
    const currentUserRole = (session?.user as any)?.role;
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (currentUserRole !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const users = await db.select().from(usersTable).orderBy(asc(usersTable.name));

    return NextResponse.json(users);
  } catch (error: any) {
    console.error("GET /api/users error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** 
 * POST /api/users — create & invite user (admin only) 
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    const currentUserRole = (session?.user as any)?.role;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (currentUserRole !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const { name, email, sendEmail = true } = body;

    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

    // Check for existing user
    const normalizedEmail = email.toLowerCase().trim();
    const existingRows = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
    if (existingRows.length > 0) {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }

    const id = `usr_${randomBytes(8).toString("hex")}`;
    const inviteToken = randomBytes(32).toString("hex");
    const now = new Date().toISOString();

    await db.insert(usersTable).values({
      id,
      name: name || email.split("@")[0],
      email: normalizedEmail,
      role: 'user',
      status: 'active',
      isSuperAdmin: false,
      canAccessArchitect: false,
      canAccessBRD: false,
      canAccessTimeline: false,
      canAccessTasks: true,
      canAccessCalendar: true,
      canAccessMeetings: false,
      canAccessAccounts: false,
      canAccessSolutions: false,
      inviteToken,
      invitedBy: currentUserId,
      invitedAt: now
    });

    // Send invite email
    let emailSent = false;
    let emailError: string | null = null;
    if (sendEmail) {
      try {
        const inviterName = session?.user?.name || session?.user?.email || "A team admin";
        await sendInviteEmail({
          to: email,
          inviteeName: name || "",
          invitedByName: inviterName,
          inviteToken,
        });
        emailSent = true;
      } catch (e: any) {
        console.error("Invite email failed:", e);
        emailError = e.message;
      }
    }

    const createdRows = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
    const createdUser = createdRows[0] || {};

    return NextResponse.json({
      user: {
        id: createdUser.id,
        name: createdUser.name,
        email: createdUser.email,
        role: createdUser.role || "user",
        status: createdUser.status || "active",
        inviteToken: createdUser.inviteToken || null,
        invitedAt: createdUser.invitedAt || null,
      },
      emailSent,
      emailError,
    }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/users error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to invite user." },
      { status: 500 }
    );
  }
}
