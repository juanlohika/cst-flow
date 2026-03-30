import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/users/members
 * Returns all active users + all roles for the task assignment picker.
 * Combined response so the picker only needs one fetch.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [users, roles] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, email, image, role FROM User
       WHERE status = 'approved' OR status = 'active'
       ORDER BY name ASC`
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name FROM Role ORDER BY name ASC`
    ),
  ]);

  return NextResponse.json({ users, roles });
}
