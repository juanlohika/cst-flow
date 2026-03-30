import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = params;

    // Use raw SQL fallback for robustness
    let project: any = null;
    try {
      project = await (prisma as any).tarkieProject.findUnique({
        where: { id: projectId }
      });
    } catch {
      console.warn("tarkieProject model missing, using raw SQL");
      const results = await prisma.$queryRawUnsafe(
        `SELECT * FROM TarkieProject WHERE id = ? LIMIT 1`,
        projectId
      ) as any[];
      project = results[0] || null;
    }

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error: any) {
    console.error("error fetching project:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
