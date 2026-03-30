import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const appType = searchParams.get("appType");
    const clientProfileId = searchParams.get("clientProfileId");

    const where: any = { userId: session.user.id };
    if (appType) where.appType = appType;
    if (clientProfileId) where.clientProfileId = clientProfileId;

    const works = await prisma.savedWork.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(works);
  } catch (error: any) {
    console.error("Fetch works error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch works" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { id, appType, title, data, clientProfileId, flowCategory, status } = body;

    if (!appType || !title || !data) {
      return NextResponse.json({ error: "appType, title, and data are required" }, { status: 400 });
    }

    // Upsert: if id provided and record exists for this user, update it
    if (id) {
      const existing = await prisma.savedWork.findFirst({
        where: { id, userId: session.user.id },
      });
      if (existing) {
        const setClauses: string[] = ['"title" = ?', '"data" = ?', '"updatedAt" = ?'];
        const values: any[] = [title, data, new Date().toISOString()];
        if (clientProfileId !== undefined) { setClauses.push('"clientProfileId" = ?'); values.push(clientProfileId || null); }
        if (flowCategory !== undefined) { setClauses.push('"flowCategory" = ?'); values.push(flowCategory || null); }
        if (status !== undefined) { setClauses.push('"status" = ?'); values.push(status || 'open'); }
        values.push(id);
        await prisma.$executeRawUnsafe(
          `UPDATE SavedWork SET ${setClauses.join(", ")} WHERE id = ?`,
          ...values
        );
        const updated = await prisma.savedWork.findFirst({ where: { id } });
        return NextResponse.json(updated);
      }
    }

    const newId = `sw_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO SavedWork (id, userId, appType, title, data, clientProfileId, flowCategory, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId, session.user.id, appType, title, data,
      clientProfileId || null, flowCategory || null, status || 'open', now, now
    );
    const work = await prisma.savedWork.findFirst({ where: { id: newId } });

    return NextResponse.json(work);
  } catch (error: any) {
    console.error("Create work error:", error);
    return NextResponse.json({ error: error.message || "Failed to save work" }, { status: 500 });
  }
}
