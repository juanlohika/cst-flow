import { NextResponse } from "next/server";
import { db } from "@/db";
import { users as usersTable } from "@/db/schema";
import { randomBytes } from "crypto";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "lester.alarcon@mobileoptima.com";
const ADMIN_NAME  = "Lester Alarcon";

/**
 * POST /api/users/ensure-admin
 * Idempotent: creates the default admin user if they don't exist yet.
 * MIGRATED TO DRIZZLE
 */
export async function POST() {
  try {
    const existing = await db.select({
      id: usersTable.id,
      status: usersTable.status,
      role: usersTable.role
    })
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL))
    .limit(1);

    if (existing.length > 0) {
      const u = existing[0];
      if (u.role !== "admin" || u.status !== "active") {
        await db.update(usersTable)
          .set({ role: 'admin', status: 'active', isSuperAdmin: true })
          .where(eq(usersTable.email, ADMIN_EMAIL));
      }
      return NextResponse.json({ created: false, message: "Admin account already exists" });
    }

    const id = `admin_${randomBytes(8).toString("hex")}`;
    await db.insert(usersTable).values({
      id,
      name: ADMIN_NAME,
      email: ADMIN_EMAIL,
      role: 'admin',
      status: 'active',
      isSuperAdmin: true,
      canAccessArchitect: true,
      canAccessBRD: true,
      canAccessTimeline: true,
      canAccessTasks: true,
      canAccessCalendar: true,
      canAccessMeetings: true,
      canAccessAccounts: true,
      canAccessSolutions: true
    });

    return NextResponse.json({ created: true, message: `Admin account created for ${ADMIN_EMAIL}` }, { status: 201 });
  } catch (error: any) {
    console.error("POST /api/users/ensure-admin error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
