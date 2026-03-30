import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get("projectId");
    const showArchived = searchParams.get("showArchived") === "true";

    // ABSOLUTE MINIMAL FRESH ROUTE
    const tasks = await prisma.timelineItem.findMany({
      where: (projectId && projectId !== "ALL") ? { projectId, archived: showArchived } : { archived: showArchived },
      include: { project: { select: { name: true } } },
      orderBy: { sortOrder: "asc" }
    });

    return NextResponse.json(tasks.filter(t => !t.parentId));
  } catch (err: any) {
    console.error("Fresh Route Failure:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
