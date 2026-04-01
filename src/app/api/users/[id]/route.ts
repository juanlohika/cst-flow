import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/** 
 * PATCH /api/users/[id] — update user 
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const { id: targetUserId } = params;
    const currentUserRole = (session.user as any).role;
    const isAdmin = currentUserRole === "admin";

    // Users can update their own profile; admins can update anything
    const isSelf = currentUserId === targetUserId;
    if (!isAdmin && !isSelf) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const updateData: any = {};

    // Fields any user can update about themselves
    if (body.name !== undefined) updateData.name = body.name;
    if (body.image !== undefined) updateData.image = body.image;

    // Admin-only fields
    if (isAdmin) {
      if (body.role !== undefined) updateData.role = body.role;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.profileRole !== undefined) updateData.profileRole = body.profileRole || null;
      if (body.canAccessArchitect !== undefined) updateData.canAccessArchitect = !!body.canAccessArchitect;
      if (body.canAccessBRD !== undefined) updateData.canAccessBRD = !!body.canAccessBRD;
      if (body.canAccessTimeline !== undefined) updateData.canAccessTimeline = !!body.canAccessTimeline;
      if (body.canAccessTasks !== undefined) updateData.canAccessTasks = !!body.canAccessTasks;
      if (body.canAccessCalendar !== undefined) updateData.canAccessCalendar = !!body.canAccessCalendar;
      if (body.canAccessMeetings !== undefined) updateData.canAccessMeetings = !!body.canAccessMeetings;
      if (body.canAccessAccounts !== undefined) updateData.canAccessAccounts = !!body.canAccessAccounts;
      if (body.canAccessSolutions !== undefined) updateData.canAccessSolutions = !!body.canAccessSolutions;
      if (body.supervisorId !== undefined) updateData.supervisorId = body.supervisorId || null;
    }

    if (Object.keys(updateData).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });

    await db.update(usersTable)
      .set(updateData)
      .where(eq(usersTable.id, targetUserId));

    const updatedRows = await db.select().from(usersTable).where(eq(usersTable.id, targetUserId)).limit(1);
    const user = updatedRows[0];

    if (!user) {
      return NextResponse.json({ error: "User not found after update" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error: any) {
    console.error("PATCH /api/users/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update user" },
      { status: 500 }
    );
  }
}

/** 
 * DELETE /api/users/[id] — block user (soft delete) 
 * MIGRATED TO DRIZZLE
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const currentUserId = session?.user?.id;
    if (!currentUserId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if ((session.user as any).role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id: targetUserId } = params;

    // Prevent self-deletion
    if (currentUserId === targetUserId) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }

    // Soft-delete: set status to blocked
    await db.update(usersTable)
      .set({ status: 'blocked' })
      .where(eq(usersTable.id, targetUserId));

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE /api/users/[id] error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete user" },
      { status: 500 }
    );
  }
}
