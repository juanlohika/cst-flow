import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

/**
 * PATCH /api/meetings/[id]/attendees/[attendeeId]
 * Update attendee status or details (authenticated)
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; attendeeId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify organizer owns this meeting
    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { attendanceStatus, fullName, position, companyName, mobileNumber, email } = body;

    const data: any = {};
    if (attendanceStatus) data.attendanceStatus = attendanceStatus;
    if (fullName !== undefined) data.fullName = fullName;
    if (position !== undefined) data.position = position;
    if (companyName !== undefined) data.companyName = companyName;
    if (mobileNumber !== undefined) data.mobileNumber = mobileNumber;
    if (email !== undefined) data.email = email;

    const updated = await prisma.meetingAttendee.update({
      where: { id: params.attendeeId },
      data,
    });

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/meetings/[id]/attendees/[attendeeId]
 * Remove an attendee (authenticated)
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string; attendeeId: string } }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.meetingAttendee.delete({ where: { id: params.attendeeId } });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
