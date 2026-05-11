import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  clientProfiles as clientProfilesTable,
  meetingPrepSessions as meetingPrepSessionsTable,
  users as usersTable,
  accountMemberships as membershipsTable,
} from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc, inArray, sql } from "drizzle-orm";
import { ensureUserInDb } from "@/lib/utils/auth-sync";
import {
  listAccessibleClientIds,
  ensureClientCodeAndToken,
  uniqueClientCode,
  generateAccessToken,
} from "@/lib/access/accounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/meeting-prep/profiles
 * Fetch all client profiles for the current user
 * MIGRATED TO DRIZZLE
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = (session.user as any)?.role === "admin";

    const allowedIds = await listAccessibleClientIds({ userId, isAdmin });
    if (allowedIds !== null && allowedIds.length === 0) {
      return NextResponse.json([]);
    }

    // Build the SELECT as a fresh Drizzle query each attempt — Drizzle builders
    // are NOT reusable after await, so we factor this into a function.
    async function fetchProfiles(includeNewColumns: boolean): Promise<any[]> {
      const base = includeNewColumns
        ? db.select({
            id: clientProfilesTable.id,
            userId: clientProfilesTable.userId,
            companyName: clientProfilesTable.companyName,
            industry: clientProfilesTable.industry,
            companySize: clientProfilesTable.companySize,
            modulesAvailed: clientProfilesTable.modulesAvailed,
            engagementStatus: clientProfilesTable.engagementStatus,
            primaryContact: clientProfilesTable.primaryContact,
            primaryContactEmail: clientProfilesTable.primaryContactEmail,
            specialConsiderations: clientProfilesTable.specialConsiderations,
            intelligenceContent: clientProfilesTable.intelligenceContent,
            createdAt: clientProfilesTable.createdAt,
            updatedAt: clientProfilesTable.updatedAt,
          }).from(clientProfilesTable).orderBy(desc(clientProfilesTable.createdAt))
        : db.select({
            id: clientProfilesTable.id,
            userId: clientProfilesTable.userId,
            companyName: clientProfilesTable.companyName,
            industry: clientProfilesTable.industry,
            modulesAvailed: clientProfilesTable.modulesAvailed,
            engagementStatus: clientProfilesTable.engagementStatus,
            createdAt: clientProfilesTable.createdAt,
            updatedAt: clientProfilesTable.updatedAt,
          }).from(clientProfilesTable).orderBy(desc(clientProfilesTable.createdAt));

      return allowedIds === null
        ? await base
        : await base.where(inArray(clientProfilesTable.id, allowedIds));
    }

    let profiles: any[] = [];
    try {
      profiles = await fetchProfiles(true);
    } catch (selErr: any) {
      console.warn("[meeting-prep/profiles] full select failed, trying minimal:", selErr?.message);
      try {
        profiles = await fetchProfiles(false);
      } catch (selErr2: any) {
        console.error("[meeting-prep/profiles] minimal select ALSO failed:", selErr2?.message);
        profiles = [];
      }
    }

    // Fetch meeting prep sessions separately (tolerant — non-critical, safe to skip)
    const profileIds = profiles.map((p: any) => p.id);
    let sessions: any[] = [];
    if (profileIds.length > 0) {
      try {
        sessions = await db.select({
          id: meetingPrepSessionsTable.id,
          userId: meetingPrepSessionsTable.userId,
          clientProfileId: meetingPrepSessionsTable.clientProfileId,
          meetingType: meetingPrepSessionsTable.meetingType,
          status: meetingPrepSessionsTable.status,
          createdAt: meetingPrepSessionsTable.createdAt,
          updatedAt: meetingPrepSessionsTable.updatedAt,
        })
          .from(meetingPrepSessionsTable)
          .where(inArray(meetingPrepSessionsTable.clientProfileId, profileIds))
          .orderBy(desc(meetingPrepSessionsTable.updatedAt));
      } catch (sessErr: any) {
        console.warn("[meeting-prep/profiles] sessions fetch failed, skipping:", sessErr?.message);
        sessions = [];
      }
    }

    // Merge sessions into profiles
    const sessionsByProfile: Record<string, any[]> = {};
    for (const s of sessions) {
      const pid = s.clientProfileId;
      if (!sessionsByProfile[pid]) sessionsByProfile[pid] = [];
      sessionsByProfile[pid].push(s);
    }

    const formatted = profiles.map((p: any) => ({
      ...p,
      modulesAvailed: (() => { try { return JSON.parse(p.modulesAvailed || "[]"); } catch { return []; } })(),
      meetingPrepSessions: sessionsByProfile[p.id] || [],
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("Fetch profiles error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch profiles" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/meeting-prep/profiles
 * Create a new client profile
 * MIGRATED TO DRIZZLE
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const {
      companyName,
      industry,
      modulesAvailed,
      engagementStatus,
      primaryContact,
      primaryContactEmail,
      specialConsiderations,
    } = body;

    if (!companyName?.trim()) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    // ENSURE: Synchronize user with DB to prevent FK failure
    await ensureUserInDb(session);

    const id = `cp_${Date.now()}`;
    const now = new Date().toISOString();
    const clientCode = await uniqueClientCode(companyName.trim());
    const accessToken = generateAccessToken();

    // Drizzle: Direct insert with all fields
    await db.insert(clientProfilesTable).values({
      id,
      userId,
      companyName: companyName.trim(),
      industry: industry || "general",
      modulesAvailed: JSON.stringify(modulesAvailed || []),
      engagementStatus: engagementStatus || "confirmed",
      primaryContact: primaryContact || "",
      primaryContactEmail: primaryContactEmail || "",
      specialConsiderations: specialConsiderations || "",
      clientCode,
      accessToken,
      createdAt: now,
      updatedAt: now,
    });

    // Auto-grant the creator a "lead" membership so they don't lock themselves out
    try {
      await db.insert(membershipsTable).values({
        id: `mem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`,
        userId,
        clientProfileId: id,
        role: "lead",
        grantedBy: userId,
        grantedAt: now,
      });
    } catch (e) {
      console.warn("[accounts POST] could not auto-grant creator membership:", e);
    }

    // Read back
    const created = await db.select()
      .from(clientProfilesTable)
      .where(eq(clientProfilesTable.id, id))
      .limit(1);

    const profile = created[0] || {};
    return NextResponse.json({
      ...profile,
      modulesAvailed: (() => { try { return JSON.parse(profile.modulesAvailed || "[]"); } catch { return []; } })(),
    }, { status: 201 });

  } catch (error: any) {
    console.error("POST /api/meeting-prep/profiles error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create profile" },
      { status: 500 }
    );
  }
}
