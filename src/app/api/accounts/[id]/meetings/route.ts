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

    const meetings = await prisma.tarkieMeeting.findMany({
      where: { clientProfileId: accountId, userId: session.user.id },
      orderBy: { scheduledAt: "desc" },
    });

    // Fetch attendee counts separately (libsql adapter - no include)
    const meetingIds = meetings.map((m: any) => m.id);
    const attendees = meetingIds.length > 0
      ? await prisma.meetingAttendee.findMany({ where: { meetingId: { in: meetingIds } } })
      : [];

    const countByMeeting: Record<string, number> = {};
    for (const a of attendees) {
      countByMeeting[a.meetingId] = (countByMeeting[a.meetingId] || 0) + 1;
    }

    const result = meetings.map((m: any) => ({
      ...m,
      attendeeCount: countByMeeting[m.id] || 0,
    }));

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Account meetings error:", error);
    return NextResponse.json({ error: error.message || "Failed to fetch meetings" }, { status: 500 });
  }
}
