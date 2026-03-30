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

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const clientProfileId = url.searchParams.get("clientProfileId");
    const meetingType = url.searchParams.get("meetingType");
    const meetingPrepSessionId = url.searchParams.get("meetingPrepSessionId");

    const where: any = { userId: session.user.id };
    if (status) where.status = status;
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (meetingPrepSessionId) {
      where.id = meetingPrepSessionId;
    } else if (meetingType) {
      if (meetingType.includes(",")) {
        where.meetingType = { in: meetingType.split(",").map(t => t.trim()) };
      } else {
        where.meetingType = meetingType;
      }
    }

    const sessions = await prisma.meetingPrepSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });

    // Fetch related profiles separately to avoid libsql include issues
    const profileIds = Array.from(new Set(sessions.map((s: any) => s.clientProfileId)));
    const profiles = profileIds.length > 0
      ? await prisma.clientProfile.findMany({ where: { id: { in: profileIds } } })
      : [];
    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

    const result = sessions.map(s => ({ ...s, clientProfile: profileMap[s.clientProfileId] || null }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Fetch prep sessions error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch preparatory sessions" },
      { status: 500 }
    );
  }
}
