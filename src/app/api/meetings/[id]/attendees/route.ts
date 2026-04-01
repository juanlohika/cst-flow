import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingAttendees as meetingAttendeesTable 
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and, asc } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * GET /api/meetings/[id]/attendees
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, params.id)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const attendees = await db.select()
      .from(meetingAttendeesTable)
      .where(eq(meetingAttendeesTable.meetingId, params.id))
      .orderBy(asc(meetingAttendeesTable.registrationType), asc(meetingAttendeesTable.createdAt));

    return NextResponse.json(attendees);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/meetings/[id]/attendees
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, params.id)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { fullName, position, companyName, mobileNumber, email } = body;

    if (!fullName?.trim()) {
      return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    }

    const attendeeId = `att_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    await db.insert(meetingAttendeesTable).values({
      id: attendeeId,
      meetingId: params.id,
      fullName: fullName.trim(),
      position: position || null,
      companyName: companyName || null,
      mobileNumber: mobileNumber || null,
      email: email || null,
      registrationType: "pre-registered",
      attendanceStatus: "expected",
      consentGiven: false,
      createdAt: now
    });

    const attendeeRows = await db.select().from(meetingAttendeesTable).where(eq(meetingAttendeesTable.id, attendeeId)).limit(1);
    return NextResponse.json(attendeeRows[0], { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
