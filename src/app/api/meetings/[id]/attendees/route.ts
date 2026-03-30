import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[id]/attendees
 * List all attendees for a meeting (authenticated)
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const attendees = await prisma.meetingAttendee.findMany({
      where: { meetingId: params.id },
      orderBy: [{ registrationType: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(attendees);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/meetings/[id]/attendees
 * Pre-register an attendee (authenticated — organizer adds them in advance)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meeting = await prisma.tarkieMeeting.findFirst({
      where: { id: params.id, userId: session.user.id },
    });
    if (!meeting) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { fullName, position, companyName, mobileNumber, email } = body;

    if (!fullName?.trim()) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }

    const attendee = await prisma.meetingAttendee.create({
      data: {
        meetingId: params.id,
        fullName,
        position: position || null,
        companyName: companyName || null,
        mobileNumber: mobileNumber || null,
        email: email || null,
        registrationType: "pre-registered",
        attendanceStatus: "expected",
        consentGiven: false,
      },
    });

    return NextResponse.json(attendee, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
