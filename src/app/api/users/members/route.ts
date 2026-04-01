import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { users as usersTable, roles as rolesTable } from "@/db/schema";
import { eq, or, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/members
 * Returns all approved users + all roles for selection components.
 * MIGRATED TO DRIZZLE
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const [users, roles] = await Promise.all([
      db.select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        image: usersTable.image,
        role: usersTable.role
      })
      .from(usersTable)
      .where(or(eq(usersTable.status, 'active'), eq(usersTable.status, 'active')))
      .orderBy(asc(usersTable.name)),

      db.select({
        id: rolesTable.id,
        name: rolesTable.name
      })
      .from(rolesTable)
      .orderBy(asc(rolesTable.name))
    ]);

    return NextResponse.json({ users, roles });
  } catch (error: any) {
    console.error("GET /api/users/members error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
