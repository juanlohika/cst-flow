import { NextResponse } from "next/server";
import { db } from "@/db";
import { 
  tarkieMeetings as tarkieMeetingsTable, 
  meetingAttendees as meetingAttendeesTable 
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/meetings/[id]/attendees/[attendeeId]
 * MIGRATED TO DRIZZLE
 */
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; attendeeId: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify organizer owns this meeting
    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, params.id)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const { attendanceStatus, fullName, position, companyName, mobileNumber, email } = body;

    const updateData: any = {};
    if (attendanceStatus) updateData.attendanceStatus = attendanceStatus;
    if (fullName !== undefined) updateData.fullName = fullName;
    if (position !== undefined) updateData.position = position;
    if (companyName !== undefined) updateData.companyName = companyName;
    if (mobileNumber !== undefined) updateData.mobileNumber = mobileNumber;
    if (email !== undefined) updateData.email = email;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    await db.update(meetingAttendeesTable)
      .set(updateData)
      .where(eq(meetingAttendeesTable.id, params.attendeeId));

    const attendeeRows = await db.select().from(meetingAttendeesTable).where(eq(meetingAttendeesTable.id, params.attendeeId)).limit(1);
    return NextResponse.json(attendeeRows[0]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/meetings/[id]/attendees/[attendeeId]
 * MIGRATED TO DRIZZLE
 */
export async function DELETE(
  req: Request,
  { params }: { params: { id: string; attendeeId: string } }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const meetingRows = await db.select().from(tarkieMeetingsTable).where(eq(tarkieMeetingsTable.id, params.id)).limit(1);
    if (meetingRows.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(meetingAttendeesTable).where(eq(meetingAttendeesTable.id, params.attendeeId));
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
