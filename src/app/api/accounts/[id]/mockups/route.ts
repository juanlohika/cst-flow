import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = params.id;

    const account = await prisma.clientProfile.findFirst({
      where: { id: accountId, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const mockups = await prisma.$queryRawUnsafe<any[]>(
      `SELECT sw.id, sw.title, sw.status, sw.data, sw.createdAt, sw.updatedAt, u.name as createdByName
       FROM SavedWork sw
       LEFT JOIN User u ON u.id = sw.userId
       WHERE sw.appType = 'mockup' AND sw.clientProfileId = ? AND sw.userId = ?
       ORDER BY sw.updatedAt DESC`,
      accountId,
      session.user.id
    );

    return NextResponse.json(mockups);
  } catch (error: any) {
    console.error("Account mockups error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch mockups" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { mockupId, status } = await req.json();
    const validStatuses = ["open", "for_approval", "approved", "rejected"];
    if (!mockupId || !validStatuses.includes(status)) {
      return NextResponse.json({ error: "mockupId and valid status required" }, { status: 400 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE SavedWork SET status = ?, updatedAt = ? WHERE id = ? AND userId = ? AND appType = 'mockup'`,
      status,
      new Date().toISOString(),
      mockupId,
      session.user.id
    );

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
