import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const work = await prisma.savedWork.findFirst({
      where: { id: params.id, userId: session.user.id },
    });

    if (!work) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(work);
  } catch (error: any) {
    console.error("Get work error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch work" }, { status: 500 });
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

    // Verify ownership first
    const existing = await prisma.savedWork.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await req.json();
    const ALLOWED = ["title", "data", "clientProfileId", "flowCategory"];
    const setClauses: string[] = [];
    const values: any[] = [];

    for (const key of ALLOWED) {
      if (!(key in body) || body[key] === undefined) continue;
      setClauses.push(`"${key}" = ?`);
      values.push(body[key] ?? null);
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    setClauses.push(`"updatedAt" = ?`);
    values.push(new Date().toISOString());
    values.push(params.id);

    await prisma.$executeRawUnsafe(
      `UPDATE SavedWork SET ${setClauses.join(", ")} WHERE id = ?`,
      ...values
    );

    const updated = await prisma.savedWork.findFirst({
      where: { id: params.id },
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("Update work error:", error);
    return NextResponse.json({ error: error.message || "Failed to update work" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const existing = await prisma.savedWork.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.$executeRawUnsafe(`DELETE FROM SavedWork WHERE id = ?`, params.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Delete work error:", error);
    return NextResponse.json({ error: error.message || "Failed to delete work" }, { status: 500 });
  }
}
