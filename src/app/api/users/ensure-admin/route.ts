import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "lester.alarcon@mobileoptima.com";
const ADMIN_NAME  = "Lester Alarcon";

/**
 * POST /api/users/ensure-admin
 * Idempotent: creates the default admin user if they don't exist yet.
 * No auth required — this is a bootstrap endpoint (safe: only creates one known email).
 */
export async function POST() {
  const existing = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, status, role FROM User WHERE email = ?`, ADMIN_EMAIL
  );

  if (existing.length > 0) {
    const u = existing[0];
    // Ensure correct role + status even if record exists
    if (u.role !== "admin" || u.status !== "approved") {
      await prisma.$executeRawUnsafe(
        `UPDATE User SET role = 'admin', status = 'approved' WHERE email = ?`, ADMIN_EMAIL
      );
    }
    return NextResponse.json({ created: false, message: "Admin account already exists" });
  }

  const id = `admin_${randomBytes(8).toString("hex")}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO User (id, name, email, role, status, isSuperAdmin,
      canAccessArchitect, canAccessBRD, canAccessTimeline,
      canAccessTasks, canAccessCalendar, canAccessMeetings, canAccessAccounts, canAccessSolutions)
     VALUES (?, ?, ?, 'admin', 'approved', 1, 1, 1, 1, 1, 1, 1, 1, 1)`,
    id, ADMIN_NAME, ADMIN_EMAIL
  );

  return NextResponse.json({ created: true, message: `Admin account created for ${ADMIN_EMAIL}` }, { status: 201 });
}
