import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const apps = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, provider
       FROM App ORDER BY sortOrder ASC, name ASC`
    );
    return NextResponse.json(apps);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session || (session.user as any)?.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { name, slug, description, icon, href, isActive, sortOrder } = await req.json();
    if (!name || !slug || !href) {
      return NextResponse.json({ error: "name, slug, href required" }, { status: 400 });
    }
    const id = `app_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(
      `INSERT INTO App (id, name, slug, description, icon, href, isActive, isBuiltIn, sortOrder, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      id, name, slug, description ?? null, icon ?? null, href,
      isActive !== false ? 1 : 0, sortOrder ?? 0, now, now
    );
    return NextResponse.json({ id, name, slug, href });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
