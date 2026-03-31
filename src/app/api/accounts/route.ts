import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/accounts
 * Lightweight account list for dropdowns and selectors
 * PRODUCTION-SAFE: Uses raw SQL to avoid Prisma schema-mismatch on Turso
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accounts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, companyName, industry, engagementStatus
       FROM ClientProfile
       WHERE userId = ?
       ORDER BY companyName ASC`,
      session.user.id
    );

    return NextResponse.json(accounts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
