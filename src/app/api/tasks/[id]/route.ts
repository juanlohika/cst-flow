import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// GET /api/tasks/[id] — fetch single task with history
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const history = await prisma.taskHistory.findMany({
      where: { timelineItemId: params.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(history);
  } catch (error: any) {
    console.error("GET /api/tasks/[id] error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
