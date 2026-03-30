import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await prisma.$queryRawUnsafe<
      { id: string; owner: string; dailyHours: number; restDays: string }[]
    >("SELECT id, owner, dailyHours, restDays FROM UserCapacity ORDER BY owner ASC");
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { owner, dailyHours, restDays } = await req.json();
  if (!owner) return NextResponse.json({ error: "owner required" }, { status: 400 });

  const id = `cap_${owner}_${Date.now()}`;
  const hours = dailyHours ?? 8;
  const rest = restDays ?? "Saturday,Sunday";
  const now = new Date().toISOString();

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO UserCapacity (id, owner, dailyHours, restDays, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(owner) DO UPDATE SET dailyHours = excluded.dailyHours, restDays = excluded.restDays, updatedAt = excluded.updatedAt`,
      id, owner, hours, rest, now, now
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
