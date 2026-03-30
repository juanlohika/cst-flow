import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { findNextAvailableSlot, CapacityRow } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { owner, durationHours, afterDate } = await req.json();
    if (!owner || !durationHours) {
      return NextResponse.json({ error: "owner and durationHours required" }, { status: 400 });
    }

    const after = afterDate ? new Date(afterDate) : new Date();

    // Fetch all active tasks for conflict-aware slot finding
    const tasks = await prisma.$queryRawUnsafe<any[]>(
      `SELECT owner, plannedStart, plannedEnd, durationHours, status, archived
       FROM TimelineItem
       WHERE archived = 0 AND status != 'completed'`
    );

    // Fetch owner capacity
    let capacityRow: CapacityRow;
    try {
      const rows = await prisma.$queryRawUnsafe<CapacityRow[]>(
        "SELECT owner, dailyHours, restDays FROM UserCapacity WHERE owner = ?",
        owner
      );
      capacityRow = rows[0] ?? { owner, dailyHours: 8, restDays: "Saturday,Sunday" };
    } catch {
      capacityRow = { owner, dailyHours: 8, restDays: "Saturday,Sunday" };
    }

    const suggestedStart = findNextAvailableSlot(owner, durationHours, after, tasks, capacityRow);
    const suggestedEnd = new Date(suggestedStart.getTime() + durationHours * 3600000);

    return NextResponse.json({
      suggestedStart: suggestedStart.toISOString(),
      suggestedEnd: suggestedEnd.toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
