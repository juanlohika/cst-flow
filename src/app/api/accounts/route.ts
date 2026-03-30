import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accounts = await prisma.clientProfile.findMany({
      where: { userId: session.user.id },
      orderBy: { companyName: "asc" },
      select: { id: true, companyName: true, industry: true, engagementStatus: true },
    });

    return NextResponse.json(accounts);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
