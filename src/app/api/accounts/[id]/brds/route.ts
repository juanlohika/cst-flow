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

    // 1. Standalone BRDs saved via BRD Maker
    const standalone = await prisma.savedWork.findMany({
      where: { appType: "brd", clientProfileId: accountId, userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    });

    // 2. BRDs generated from meetings (via MeetingTranscript.generatedBRD)
    const meetings = await prisma.tarkieMeeting.findMany({
      where: { clientProfileId: accountId, userId: session.user.id },
      orderBy: { scheduledAt: "desc" },
    });

    const meetingIds = meetings.map((m: any) => m.id);
    const transcripts = meetingIds.length > 0
      ? await prisma.meetingTranscript.findMany({
          where: {
            meetingId: { in: meetingIds },
            generatedBRD: { not: null },
          },
        })
      : [];

    const meetingMap = Object.fromEntries(meetings.map((m: any) => [m.id, m]));

    const fromMeetings = transcripts
      .filter((t: any) => t.generatedBRD)
      .map((t: any) => ({
        id: t.id,
        source: "meeting" as const,
        meetingId: t.meetingId,
        meetingTitle: meetingMap[t.meetingId]?.title || "Untitled Meeting",
        meetingDate: meetingMap[t.meetingId]?.scheduledAt,
        content: t.generatedBRD,
        updatedAt: t.updatedAt,
      }));

    return NextResponse.json({
      standalone: standalone.map((w: any) => ({ ...w, source: "standalone" })),
      fromMeetings,
    });
  } catch (error: any) {
    console.error("Account BRDs error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch BRDs" }, { status: 500 });
  }
}
