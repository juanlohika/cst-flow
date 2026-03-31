import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const roles = await prisma.$queryRawUnsafe<{ id: string; name: string; createdAt: string }[]>(
      "SELECT id, name, createdAt FROM Role ORDER BY createdAt ASC"
    );
    return NextResponse.json(roles);
  } catch (error: any) {
    console.error("GET /api/settings/roles error:", error);
    return NextResponse.json([], { status: 200 }); // Return empty array on error for UI stability
  }
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.$executeRawUnsafe(
    "INSERT INTO Role (id, name, createdAt) VALUES (?, ?, datetime('now'))",
    id, name.trim()
  );

  return NextResponse.json({ id, name: name.trim() }, { status: 201 });
}
