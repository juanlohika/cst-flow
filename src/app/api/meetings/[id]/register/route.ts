import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/meetings/[id]/register
 * Register or confirm attendance via QR code scan
 * Public endpoint - no auth required (for on-site registration)
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await req.json();

    const {
      attendeeId,
      fullName,
      position,
      companyName,
      mobileNumber,
      email,
      consentGiven,
    } = body;

    if (!consentGiven) {
      return NextResponse.json(
        { error: "Consent is required" },
        { status: 400 }
      );
    }

    // Fetch meeting
    const meeting = await prisma.tarkieMeeting.findUnique({
      where: { id: id as string },
    });

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    let attendee: any = null;

    // ── Path A: attendeeId provided — mark a pre-registered attendee present ──
    if (attendeeId) {
      attendee = await prisma.meetingAttendee.findFirst({
        where: { id: attendeeId, meetingId: id as string },
      });
      if (!attendee) {
        return NextResponse.json({ error: "Attendee not found" }, { status: 404 });
      }
      if (attendee.attendanceStatus === "confirmed" || attendee.attendanceStatus === "attended") {
        return NextResponse.json({ message: "Already registered", attendee }, { status: 200 });
      }
      attendee = await prisma.meetingAttendee.update({
        where: { id: attendeeId },
        data: { attendanceStatus: "attended", consentGiven: true },
      });
      return NextResponse.json({ message: "Registration successful", attendee }, { status: 200 });
    }

    // ── Path B: new walk-in registration ──────────────────────────────────────
    if (!fullName) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }

    // Check if already registered by email or phone
    if (email) {
      attendee = await prisma.meetingAttendee.findFirst({
        where: { meetingId: id as string, email },
      });
    } else if (mobileNumber) {
      attendee = await prisma.meetingAttendee.findFirst({
        where: { meetingId: id as string, mobileNumber },
      });
    }

    if (attendee && attendee.registrationType === "pre-registered") {
      // Confirm pre-registered attendee matched by email/mobile
      attendee = await prisma.meetingAttendee.update({
        where: { id: attendee.id },
        data: { attendanceStatus: "attended", consentGiven: true },
      });
    } else if (!attendee) {
      // Create new walk-in attendee
      attendee = await prisma.meetingAttendee.create({
        data: {
          meetingId: id as string,
          fullName,
          position,
          companyName,
          mobileNumber,
          email,
          registrationType: "qr-scan",
          attendanceStatus: "confirmed",
          consentGiven: true,
        },
      });
    } else {
      // Already exists and confirmed
      return NextResponse.json(
        { message: "Already registered", attendee },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        message: "Registration successful",
        attendee,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to register" },
      { status: 500 }
    );
  }
}
