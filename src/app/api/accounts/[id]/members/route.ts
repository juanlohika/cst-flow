import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import {
  accountMemberships as membershipsTable,
  users as usersTable,
  clientProfiles as clientProfilesTable,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Admin-only endpoints for managing AccountMembership rows.
 *   GET   /api/accounts/[id]/members             → list members of a client account
 *   POST  /api/accounts/[id]/members             → grant a user access (body: { userId, role? })
 *   DELETE /api/accounts/[id]/members?userId=... → revoke a user's access
 */

function requireAdmin(session: any) {
  if (!session?.user?.id) return { error: { status: 401, message: "Unauthorized" } } as const;
  if ((session.user as any).role !== "admin") {
    return { error: { status: 403, message: "Admin only" } } as const;
  }
  return { ok: true } as const;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }

    // Verify the account exists
    const profile = await db
      .select({ id: clientProfilesTable.id, companyName: clientProfilesTable.companyName })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (profile.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        id: membershipsTable.id,
        userId: membershipsTable.userId,
        role: membershipsTable.role,
        grantedBy: membershipsTable.grantedBy,
        grantedAt: membershipsTable.grantedAt,
        userName: usersTable.name,
        userEmail: usersTable.email,
        userRole: usersTable.role,
      })
      .from(membershipsTable)
      .leftJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
      .where(eq(membershipsTable.clientProfileId, params.id));

    return NextResponse.json({ account: profile[0], members: rows });
  } catch (error: any) {
    console.error("[members GET] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }

    const body = await req.json();
    const targetUserId = body.userId as string | undefined;
    const role = (body.role as string) || "member";
    if (!targetUserId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    // Verify the account exists
    const accountExists = await db
      .select({ id: clientProfilesTable.id })
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, params.id))
      .limit(1);
    if (accountExists.length === 0) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Verify the target user exists
    const targetUser = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId))
      .limit(1);
    if (targetUser.length === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Already a member?
    const existing = await db
      .select({ id: membershipsTable.id })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.userId, targetUserId),
          eq(membershipsTable.clientProfileId, params.id)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      // Idempotent: update role if changed
      await db
        .update(membershipsTable)
        .set({ role })
        .where(eq(membershipsTable.id, existing[0].id));
      return NextResponse.json({ id: existing[0].id, role, alreadyMember: true });
    }

    const id = `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    await db.insert(membershipsTable).values({
      id,
      userId: targetUserId,
      clientProfileId: params.id,
      role,
      grantedBy: session.user.id,
      grantedAt: new Date().toISOString(),
    });

    return NextResponse.json({ id, role, user: targetUser[0] }, { status: 201 });
  } catch (error: any) {
    console.error("[members POST] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const gate = requireAdmin(session);
    if ("error" in gate) {
      return NextResponse.json({ error: gate.error.message }, { status: gate.error.status });
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get("userId");
    if (!targetUserId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    await db
      .delete(membershipsTable)
      .where(
        and(
          eq(membershipsTable.userId, targetUserId),
          eq(membershipsTable.clientProfileId, params.id)
        )
      );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[members DELETE] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
