import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[id]/attendees/lookup?email=...&mobile=...
 * Public — checks if someone is pre-registered so the QR page can greet them by name.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email")?.trim();
    const mobile = searchParams.get("mobile")?.trim();

    if (!email && !mobile) {
      return NextResponse.json({ attendee: null });
    }

    const conditions: any[] = [];
    if (email) conditions.push({ email });
    if (mobile) conditions.push({ mobileNumber: mobile });

    const attendee = await prisma.meetingAttendee.findFirst({
      where: {
        meetingId: params.id,
        registrationType: "pre-registered",
        OR: conditions,
      },
      select: {
        id: true,
        fullName: true,
        position: true,
        companyName: true,
        email: true,
        mobileNumber: true,
        attendanceStatus: true,
      },
    });

    return NextResponse.json({ attendee });
  } catch (err: any) {
    return NextResponse.json({ attendee: null });
  }
}
