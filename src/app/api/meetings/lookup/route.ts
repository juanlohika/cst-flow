import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const qr = url.searchParams.get("qr")?.trim();
    const id = url.searchParams.get("id")?.trim();

    if (!qr && !id) {
      return NextResponse.json({ error: "Missing id or qr parameter" }, { status: 400 });
    }

    const meeting = await prisma.tarkieMeeting.findFirst({
      where: id ? { id } : { qrCode: qr! },
      include: { attendees: { select: { id: true } } },
    });

    if (!meeting) {
      return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: meeting.id,
      meetingId: meeting.id,
      title: meeting.title,
      companyName: meeting.companyName,
      meetingType: meeting.meetingType,
      scheduledAt: meeting.scheduledAt,
      status: meeting.status,
      attendeesCount: meeting.attendees.length,
    });
  } catch (error: any) {
    console.error("Lookup meeting by QR error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to lookup meeting" },
      { status: 500 }
    );
  }
}
