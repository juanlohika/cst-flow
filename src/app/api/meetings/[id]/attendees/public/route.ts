import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[id]/attendees/public
 * Public — returns the pre-registered attendee list so on-site guests can
 * find their name and mark themselves present.
 * Only safe fields are returned (no email, no mobile).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const attendees = await prisma.meetingAttendee.findMany({
      where: {
        meetingId: params.id,
        registrationType: "pre-registered",
      },
      select: {
        id: true,
        fullName: true,
        companyName: true,
        position: true,
        attendanceStatus: true,
      },
      orderBy: { fullName: "asc" },
    });

    return NextResponse.json({ attendees });
  } catch {
    return NextResponse.json({ attendees: [] });
  }
}
