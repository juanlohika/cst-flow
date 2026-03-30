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

    // Verify account belongs to this user
    const account = await prisma.clientProfile.findFirst({
      where: { id: accountId, userId: session.user.id },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const flows = await prisma.savedWork.findMany({
      where: { appType: "architect", clientProfileId: accountId, userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    });

    // Group by flowCategory
    const asIs = flows.filter((f: any) => f.flowCategory === "as-is");
    const toBe = flows.filter((f: any) => f.flowCategory === "to-be");
    const uncategorized = flows.filter((f: any) => !f.flowCategory);

    return NextResponse.json({ asIs, toBe, uncategorized });
  } catch (error: any) {
    console.error("Account flows error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch flows" }, { status: 500 });
  }
}
