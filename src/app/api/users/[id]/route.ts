import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/* ─── PATCH /api/users/[id] ─── update user ───
 * PRODUCTION-SAFE: 100% raw SQL with try/catch
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const isAdmin = (session.user as any).role === "admin";

    // Users can update their own name/image; admins can update anything
    const isSelf = session.user.id === params.id;
    if (!isAdmin && !isSelf) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();

    const setClauses: string[] = [];
    const values: any[] = [];

    // Fields any user can update about themselves
    if (body.name !== undefined) { setClauses.push("name = ?"); values.push(body.name); }
    if (body.image !== undefined) { setClauses.push("image = ?"); values.push(body.image); }

    // Admin-only fields
    if (isAdmin) {
      if (body.role !== undefined) { setClauses.push("role = ?"); values.push(body.role); }
      if (body.status !== undefined) { setClauses.push("status = ?"); values.push(body.status); }
      if (body.profileRole !== undefined) { setClauses.push("profileRole = ?"); values.push(body.profileRole || null); }
      if (body.canAccessArchitect !== undefined) { setClauses.push("canAccessArchitect = ?"); values.push(body.canAccessArchitect ? 1 : 0); }
      if (body.canAccessBRD !== undefined) { setClauses.push("canAccessBRD = ?"); values.push(body.canAccessBRD ? 1 : 0); }
      if (body.canAccessTimeline !== undefined) { setClauses.push("canAccessTimeline = ?"); values.push(body.canAccessTimeline ? 1 : 0); }
      if (body.canAccessTasks !== undefined) { setClauses.push("canAccessTasks = ?"); values.push(body.canAccessTasks ? 1 : 0); }
      if (body.canAccessCalendar !== undefined) { setClauses.push("canAccessCalendar = ?"); values.push(body.canAccessCalendar ? 1 : 0); }
      if (body.canAccessMeetings !== undefined) { setClauses.push("canAccessMeetings = ?"); values.push(body.canAccessMeetings ? 1 : 0); }
      if (body.canAccessAccounts !== undefined) { setClauses.push("canAccessAccounts = ?"); values.push(body.canAccessAccounts ? 1 : 0); }
      if (body.canAccessSolutions !== undefined) { setClauses.push("canAccessSolutions = ?"); values.push(body.canAccessSolutions ? 1 : 0); }
    }

    if (!setClauses.length) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    values.push(params.id);
    await prisma.$executeRawUnsafe(
      `UPDATE User SET ${setClauses.join(", ")} WHERE id = ?`,
      ...values
    );

    // Read back with only safe columns (avoids crash if profileRole/inviteToken don't exist)
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM User WHERE id = ?`, params.id
    );

    // Sanitize the response — provide fallbacks for potentially missing columns
    const user = updated[0] || {};
    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role || "user",
      status: user.status || "approved",
      profileRole: user.profileRole || null,
      canAccessArchitect: user.canAccessArchitect ?? 0,
      canAccessBRD: user.canAccessBRD ?? 0,
      canAccessTimeline: user.canAccessTimeline ?? 0,
      canAccessTasks: user.canAccessTasks ?? 1,
      canAccessCalendar: user.canAccessCalendar ?? 1,
      canAccessMeetings: user.canAccessMeetings ?? 0,
      canAccessAccounts: user.canAccessAccounts ?? 0,
      canAccessSolutions: user.canAccessSolutions ?? 0,
      inviteToken: user.inviteToken || null,
      invitedAt: user.invitedAt || null,
    };

    return NextResponse.json(safeUser);
  } catch (error: any) {
    console.error("PATCH /api/users/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update user" },
      { status: 500 }
    );
  }
}

/* ─── DELETE /api/users/[id] ─── block user (soft delete) ─── */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Prevent self-deletion
    if (session.user.id === params.id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }

    // Soft-delete: set status to blocked
    await prisma.$executeRawUnsafe(`UPDATE User SET status = 'blocked' WHERE id = ?`, params.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete user" },
      { status: 500 }
    );
  }
}
