import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/meeting-prep/sessions
 * PRODUCTION-SAFE: Uses raw SQL to avoid Prisma schema-mismatch on Turso
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const clientProfileId = url.searchParams.get("clientProfileId");
    const meetingType = url.searchParams.get("meetingType");
    const meetingPrepSessionId = url.searchParams.get("meetingPrepSessionId");

    // Build dynamic WHERE clause with raw SQL
    const conditions: string[] = ["userId = ?"];
    const values: any[] = [session.user.id];

    if (status) { conditions.push("status = ?"); values.push(status); }
    if (clientProfileId) { conditions.push("clientProfileId = ?"); values.push(clientProfileId); }
    if (meetingPrepSessionId) {
      conditions.push("id = ?"); values.push(meetingPrepSessionId);
    } else if (meetingType) {
      if (meetingType.includes(",")) {
        const types = meetingType.split(",").map(t => t.trim());
        const placeholders = types.map(() => "?").join(",");
        conditions.push(`meetingType IN (${placeholders})`);
        values.push(...types);
      } else {
        conditions.push("meetingType = ?");
        values.push(meetingType);
      }
    }

    const whereClause = conditions.join(" AND ");
    const sessions = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, userId, clientProfileId, meetingType, status,
              agendaContent, questionnaireContent, discussionGuide,
              preparationChecklist, anticipatedRequirements,
              createdAt, updatedAt
       FROM MeetingPrepSession
       WHERE ${whereClause}
       ORDER BY updatedAt DESC`,
      ...values
    );

    // Fetch related profiles separately with raw SQL
    const profileIds = Array.from(new Set(sessions.map((s: any) => s.clientProfileId)));
    let profiles: any[] = [];
    if (profileIds.length > 0) {
      const placeholders = profileIds.map(() => "?").join(",");
      profiles = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id, companyName, industry, engagementStatus, primaryContact
         FROM ClientProfile
         WHERE id IN (${placeholders})`,
        ...profileIds
      );
    }
    const profileMap = Object.fromEntries(profiles.map((p: any) => [p.id, p]));

    const result = sessions.map((s: any) => ({ ...s, clientProfile: profileMap[s.clientProfileId] || null }));
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Fetch prep sessions error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch preparatory sessions" },
      { status: 500 }
    );
  }
}
